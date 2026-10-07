import Foundation
import PudleCore

/// Minimal Supabase REST/Auth client (no third-party SDK). Authorization is enforced by
/// RLS on the server using the signed-in user's JWT; the app holds only the publishable key.
@MainActor
final class BackendClient {
    struct Session: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
        var userID: String
        var email: String?
    }

    struct Convoy: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let expires_at: String
    }

    enum BackendError: LocalizedError {
        case notConfigured, signedOut, http(Int, String), decoding, network(String)
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "This build has no backend configured."
            case .signedOut: return "Signed out. Sign in again."
            case .http(let code, let message): return message.isEmpty ? "Server error \(code)" : message
            case .decoding: return "Unreadable server response."
            case .network(let message): return message
            }
        }
    }

    private let config: AppConfig
    private let urlSession: URLSession
    private(set) var session: Session?
    /// False until the dev database has the hazard_events migration; then located events are read too.
    private(set) var hazardEventsAvailable = true

    init(config: AppConfig) {
        self.config = config
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        urlSession = URLSession(configuration: configuration)
        if let data = Keychain.load(account: "session"),
           let saved = try? JSONDecoder().decode(Session.self, from: data) {
            session = saved
        }
    }

    var isConfigured: Bool { config.backendConfigured }
    var userID: String? { session?.userID }

    // MARK: Auth

    func signIn(email: String, password: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let data = try await send(path: "auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "password")],
                                  method: "POST", body: body, authorized: false)
        try storeSession(from: data)
    }

    func signOut() async {
        if session != nil {
            // Revokes the refresh token server-side; local tokens are deleted regardless.
            _ = try? await send(path: "auth/v1/logout", method: "POST", body: Data("{}".utf8))
        }
        session = nil
        Keychain.delete(account: "session")
    }

    private func refreshIfNeeded() async throws {
        guard let current = session else { throw BackendError.signedOut }
        guard current.expiresAt.timeIntervalSinceNow < 60 else { return }
        let body = try JSONSerialization.data(withJSONObject: ["refresh_token": current.refreshToken])
        do {
            let data = try await send(path: "auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                                      method: "POST", body: body, authorized: false)
            try storeSession(from: data)
        } catch BackendError.http(let code, _) where code == 400 || code == 401 {
            session = nil
            Keychain.delete(account: "session")
            throw BackendError.signedOut
        }
    }

    private func storeSession(from data: Data) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = json["access_token"] as? String, let refresh = json["refresh_token"] as? String,
              let expiresIn = json["expires_in"] as? Double,
              let user = json["user"] as? [String: Any], let id = user["id"] as? String else {
            throw BackendError.decoding
        }
        let newSession = Session(accessToken: access, refreshToken: refresh,
                                 expiresAt: Date().addingTimeInterval(expiresIn), userID: id, email: user["email"] as? String)
        session = newSession
        if let encoded = try? JSONEncoder().encode(newSession) { Keychain.save(encoded, account: "session") }
    }

    // MARK: Convoys

    func listConvoys() async throws -> [Convoy] {
        let data = try await rest("convoys", query: [
            .init(name: "select", value: "id,name,expires_at"),
            .init(name: "order", value: "created_at.desc"),
            .init(name: "limit", value: "20"),
        ])
        guard let convoys = try? JSONDecoder().decode([Convoy].self, from: data) else { throw BackendError.decoding }
        return convoys
    }

    func joinConvoy(code: String) async throws -> String {
        let normalized = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalized.range(of: "^[A-F0-9]{12}$", options: .regularExpression) != nil else {
            throw BackendError.http(400, "Enter the 12-character invite code.")
        }
        let data = try await rpc("join_convoy", ["p_code": normalized])
        guard let id = try? JSONDecoder().decode(String.self, from: data) else { throw BackendError.decoding }
        return id
    }

    // MARK: Feed

    /// Canonical authorized reports for one convoy. RLS returns only rows the signed-in
    /// member may see; the client validates every row again before it can be spoken.
    func fetchEvents(convoyID: String, now: Date) async throws -> (events: [HazardEvent], rejected: Int) {
        var events: [HazardEvent] = []
        var rejected = 0
        let legacyData = try await rest("obstacle_reports", query: [
            .init(name: "select", value: "id,convoy_id,reporter_id,kind,created_at,expires_at"),
            .init(name: "convoy_id", value: "eq.\(convoyID)"),
            .init(name: "order", value: "created_at.desc"),
            .init(name: "limit", value: "25"),
        ])
        let legacyRows = (try? JSONDecoder().decode([LegacyObstacleRow].self, from: legacyData)) ?? []
        for row in legacyRows {
            switch EventDecoder.validate(row, expectedConvoy: convoyID, now: now) {
            case .success(let event): events.append(event)
            case .failure: rejected += 1
            }
        }
        if hazardEventsAvailable {
            do {
                let data = try await rest("hazard_events", query: [
                    .init(name: "select", value: "id,schema_version,convoy_id,reporter_id,kind,source,observed_at,created_at,expires_at,latitude,longitude,accuracy_m,heading_deg"),
                    .init(name: "convoy_id", value: "eq.\(convoyID)"),
                    .init(name: "order", value: "created_at.desc"),
                    .init(name: "limit", value: "25"),
                ])
                let rows = (try? JSONDecoder().decode([HazardEventRow].self, from: data)) ?? []
                for row in rows {
                    switch EventDecoder.validate(row, expectedConvoy: convoyID, now: now) {
                    case .success(let event): events.append(event)
                    case .failure: rejected += 1
                    }
                }
            } catch BackendError.http(let code, _) where code == 404 {
                hazardEventsAvailable = false  // migration not applied: legacy reports only
            }
        }
        // Oldest first so speech order follows report order.
        return (events.sorted { $0.createdAt < $1.createdAt }, rejected)
    }

    /// Sends a hand-confirmed report. `clientEventID` makes retries idempotent.
    func report(kind: HazardKind, convoyID: String, clientEventID: UUID, observedAt: Date,
                location: HazardLocation?) async throws {
        var params: [String: Any] = [
            "p_convoy_id": convoyID,
            "p_kind": kind.rawValue,
            "p_client_event_id": clientEventID.uuidString,
            "p_observed_at": PudleTime.format(observedAt),
        ]
        if let location {
            params["p_latitude"] = location.latitude
            params["p_longitude"] = location.longitude
            params["p_accuracy_m"] = location.accuracyMeters
            if let heading = location.headingDegrees { params["p_heading_deg"] = heading }
        }
        _ = try await rpc("report_hazard", params)
    }

    func setLocationConsent(_ granted: Bool) async throws {
        _ = try await rpc("set_location_consent", ["p_granted": granted, "p_policy_version": "2026-10-07"])
    }

    // MARK: Plumbing

    private func rest(_ table: String, query: [URLQueryItem]) async throws -> Data {
        try await refreshIfNeeded()
        return try await send(path: "rest/v1/\(table)", query: query, method: "GET", body: nil)
    }

    private func rpc(_ name: String, _ params: [String: Any]) async throws -> Data {
        try await refreshIfNeeded()
        let body = try JSONSerialization.data(withJSONObject: params)
        return try await send(path: "rest/v1/rpc/\(name)", method: "POST", body: body)
    }

    private func send(path: String, query: [URLQueryItem] = [], method: String, body: Data?, authorized: Bool = true) async throws -> Data {
        guard let base = config.supabaseURL, let key = config.supabaseKey else { throw BackendError.notConfigured }
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized {
            guard let token = session?.accessToken else { throw BackendError.signedOut }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let result: (Data, URLResponse)
        do {
            result = try await urlSession.data(for: request)
        } catch {
            throw BackendError.network((error as? URLError)?.code == .notConnectedToInternet ? "Offline" : "Network error")
        }
        let (data, response) = result
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 && authorized { throw BackendError.signedOut }
            // Server messages are shown on screen, never spoken.
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { ($0["message"] ?? $0["msg"] ?? $0["error_description"]) as? String } ?? ""
            throw BackendError.http(status, String(message.prefix(160)))
        }
        return data
    }
}
