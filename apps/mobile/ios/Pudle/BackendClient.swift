import Foundation
import PudleCore

/// Minimal Supabase REST/Auth/Functions client (no third-party SDK). Authorization is enforced by
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
        let join_code: String?
        let expires_at: String
    }

    /// Result of one dashcam frame check. A *possible* observation, never shared without confirmation.
    struct Detection: Decodable {
        let hazard: Bool
        let kind: String
        let side: String
        let blocks_road: Bool
        let confidence: Double
        let label: String
        let latency_ms: Int?
        let description: String?
    }

    enum BackendError: LocalizedError {
        case notConfigured, signedOut, http(Int, String), decoding, network(String), confirmEmail
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "This build has no backend configured."
            case .signedOut: return "Signed out. Sign in again."
            case .http(let code, let message): return message.isEmpty ? "Server error \(code)" : message
            case .decoding: return "Unreadable server response."
            case .network(let message): return message
            case .confirmEmail: return "Account created. Confirm it from the email Supabase sent, then sign in."
            }
        }
    }

    private let config: AppConfig
    private let urlSession: URLSession
    private(set) var session: Session?
    private var refreshTask: Task<Void, Error>?

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

    func signUp(email: String, password: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let data = try await send(path: "auth/v1/signup", method: "POST", body: body, authorized: false)
        // With email confirmation on, Supabase returns the user without a session.
        if (try? storeSession(from: data)) == nil { throw BackendError.confirmEmail }
    }

    func signOut() async {
        if session != nil {
            _ = try? await send(path: "auth/v1/logout", method: "POST", body: Data("{}".utf8))
        }
        session = nil
        Keychain.delete(account: "session")
    }

    private func refreshIfNeeded() async throws {
        guard let current = session else { throw BackendError.signedOut }
        guard current.expiresAt.timeIntervalSinceNow < 60 else { return }
        if let refreshTask { return try await refreshTask.value }
        let task = Task { @MainActor in try await self.refreshSession(current) }
        refreshTask = task
        defer { refreshTask = nil }
        try await task.value
    }

    private func refreshSession(_ current: Session) async throws {
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
            .init(name: "select", value: "id,name,join_code,expires_at"),
            .init(name: "order", value: "created_at.desc"),
            .init(name: "limit", value: "20"),
        ])
        guard let convoys = try? JSONDecoder().decode([Convoy].self, from: data) else { throw BackendError.decoding }
        return convoys
    }

    func createConvoy(name: String) async throws -> String {
        let data = try await rpc("create_convoy", ["p_name": name])
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let id = rows.first?["convoy_id"] as? String else { throw BackendError.decoding }
        return id
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
        guard let legacyRows = try? JSONDecoder().decode([LegacyObstacleRow].self, from: legacyData) else { throw BackendError.decoding }
        for row in legacyRows {
            switch EventDecoder.validate(row, expectedConvoy: convoyID, now: now) {
            case .success(let event): events.append(event)
            case .failure: rejected += 1
            }
        }
        let data = try await rest("hazard_events", query: [
            .init(name: "select", value: "id,schema_version,convoy_id,reporter_id,kind,source,side,blocks_road,observed_at,created_at,expires_at,latitude,longitude,accuracy_m,heading_deg"),
            .init(name: "convoy_id", value: "eq.\(convoyID)"),
            .init(name: "order", value: "created_at.desc"),
            .init(name: "limit", value: "50"),
        ])
        guard let hazardRows = try? JSONDecoder().decode([HazardEventRow].self, from: data) else { throw BackendError.decoding }
        for row in hazardRows {
            switch EventDecoder.validate(row, expectedConvoy: convoyID, now: now) {
            case .success(let event): events.append(event)
            case .failure: rejected += 1
            }
        }
        return (events.sorted { $0.createdAt < $1.createdAt }, rejected)
    }

    /// Latest recorded demo road for the convoy, if any.
    func fetchCorridor(convoyID: String) async throws -> RoadCorridor? {
        let data = try await rest("road_corridors", query: [
            .init(name: "select", value: "id,name,points"),
            .init(name: "convoy_id", value: "eq.\(convoyID)"),
            .init(name: "order", value: "created_at.desc"),
            .init(name: "limit", value: "1"),
        ])
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]], let row = rows.first,
              let id = row["id"] as? String, let name = row["name"] as? String,
              let raw = row["points"] as? [[Double]] else { return nil }
        let points = raw.compactMap { $0.count == 2 ? RoadCorridor.Point($0[0], $0[1]) : nil }
        return RoadCorridor(id: id, name: name, points: points)
    }

    func saveCorridor(convoyID: String, name: String, points: [RoadCorridor.Point]) async throws {
        let raw = points.map { [($0.latitude * 1e6).rounded() / 1e6, ($0.longitude * 1e6).rounded() / 1e6] }
        _ = try await rpc("save_corridor", ["p_convoy_id": convoyID, "p_name": name, "p_points": raw])
    }

    /// Sends a confirmed report. `clientEventID` makes retries idempotent.
    func report(kind: HazardKind, convoyID: String, clientEventID: UUID, observedAt: Date,
                location: HazardLocation?, source: HazardSource, side: HazardSide, blocksRoad: Bool) async throws {
        var params: [String: Any] = [
            "p_convoy_id": convoyID,
            "p_kind": kind.rawValue,
            "p_client_event_id": clientEventID.uuidString,
            "p_observed_at": PudleTime.format(observedAt),
            "p_source": source == .driverConfirmedCamera ? "driver_confirmed_camera" : "convoy_member",
            "p_side": side.rawValue,
            "p_blocks_road": blocksRoad,
        ]
        if let location {
            params["p_latitude"] = location.latitude
            params["p_longitude"] = location.longitude
            params["p_accuracy_m"] = min(location.accuracyMeters, 100)
            if let heading = location.headingDegrees { params["p_heading_deg"] = heading }
        }
        _ = try await rpc("report_hazard", params)
    }

    func setLocationConsent(_ granted: Bool) async throws {
        _ = try await rpc("set_location_consent", ["p_granted": granted, "p_policy_version": "2026-10-07"])
    }

    // MARK: Gemini edge functions

    func detectHazard(jpeg: Data, describe: Bool = false) async throws -> Detection {
        let body = try JSONSerialization.data(withJSONObject: ["image": jpeg.base64EncodedString(), "mode": describe ? "describe" : "hazard"])
        try await refreshIfNeeded()
        let data = try await send(path: "functions/v1/detect-hazard", method: "POST", body: body, timeout: 20)
        guard let result = try? JSONDecoder().decode(Detection.self, from: data) else { throw BackendError.decoding }
        return result
    }

    func synthesize(text: String, persona: Persona, timeout: TimeInterval) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: ["text": text, "persona": persona.rawValue])
        try await refreshIfNeeded()
        return try await send(path: "functions/v1/speak", method: "POST", body: body, timeout: timeout)
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

    private func send(path: String, query: [URLQueryItem] = [], method: String, body: Data?, authorized: Bool = true,
                      timeout: TimeInterval = 8) async throws -> Data {
        guard let base = config.supabaseURL, let key = config.supabaseKey else { throw BackendError.notConfigured }
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = timeout
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
            let code = (error as? URLError)?.code
            throw BackendError.network(code == .notConnectedToInternet ? "Offline" : code == .timedOut ? "Timed out" : "Network error")
        }
        let (data, response) = result
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 && authorized { throw BackendError.signedOut }
            // Server messages are shown on screen, never spoken.
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = (json?["message"] ?? json?["msg"] ?? json?["error_description"] ?? json?["error"]) as? String ?? ""
            throw BackendError.http(status, String(message.prefix(160)))
        }
        return data
    }
}
