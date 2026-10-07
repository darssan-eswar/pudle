import Foundation

/// Why an incoming row was refused before it could reach speech.
public enum EventRejection: String, Error, Equatable, Sendable {
    case malformed
    case unsupportedSchema
    case unknownKind
    case unknownSource
    case badTimestamp
    case createdInFuture
    case expired
    case tooOld
    case lifetimeTooLong
    case invalidLocation
    case wrongConvoy
}

/// Limits applied to every event before it can be announced. Server rules are
/// stricter or equal; the client checks again because a stale cache, clock skew or a
/// misconfigured backend must never cause stale speech.
public struct EventLimits: Sendable {
    public var maxClockSkew: TimeInterval = 30
    /// Legacy convoy reports live 2 minutes on the server.
    /// Blockage reports live 30 minutes on the server; nothing may be spoken after an hour.
    public var maxAge: TimeInterval = 60 * 60
    public var maxLifetime: TimeInterval = 60 * 60
    public init() {}
}

/// Timestamp parser tolerant of Postgres microsecond fractions and `+00:00` offsets.
public enum PudleTime {
    public static func parse(_ text: String) -> Date? {
        var value = text.trimmingCharacters(in: .whitespaces)
        if value.contains(" ") && !value.contains("T") { value = value.replacingOccurrences(of: " ", with: "T") }
        // Normalize fractional seconds to milliseconds.
        if let dot = value.firstIndex(of: ".") {
            var end = value.index(after: dot)
            while end < value.endIndex, value[end].isNumber { end = value.index(after: end) }
            let digits = value[value.index(after: dot)..<end]
            let millis = String((digits + "000").prefix(3))
            value = String(value[..<dot]) + "." + millis + String(value[end...])
        }
        if value.hasSuffix("+00") { value += ":00" }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }

    public static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// Row shape of the legacy web demo table `obstacle_reports` (no position).
public struct LegacyObstacleRow: Decodable, Sendable {
    public var id: String
    public var convoy_id: String
    public var reporter_id: String
    public var kind: String
    public var created_at: String
    public var expires_at: String
}

/// Row shape of `hazard_events` (schema v1, optional consented position).
public struct HazardEventRow: Decodable, Sendable {
    public var id: String
    public var schema_version: Int
    public var convoy_id: String
    public var reporter_id: String
    public var kind: String
    public var source: String
    public var observed_at: String
    public var created_at: String
    public var expires_at: String
    public var latitude: Double?
    public var longitude: Double?
    public var accuracy_m: Double?
    public var heading_deg: Double?
    public var side: String?
    public var blocks_road: Bool?

    public init(id: String, schema_version: Int, convoy_id: String, reporter_id: String, kind: String, source: String,
                observed_at: String, created_at: String, expires_at: String, latitude: Double? = nil,
                longitude: Double? = nil, accuracy_m: Double? = nil, heading_deg: Double? = nil,
                side: String? = nil, blocks_road: Bool? = nil) {
        self.id = id; self.schema_version = schema_version; self.convoy_id = convoy_id; self.reporter_id = reporter_id
        self.kind = kind; self.source = source; self.observed_at = observed_at; self.created_at = created_at
        self.expires_at = expires_at; self.latitude = latitude; self.longitude = longitude; self.accuracy_m = accuracy_m
        self.heading_deg = heading_deg; self.side = side; self.blocks_road = blocks_road
    }
}

public enum EventDecoder {
    public static func validate(_ row: LegacyObstacleRow, expectedConvoy: String?, now: Date,
                                limits: EventLimits = EventLimits()) -> Result<HazardEvent, EventRejection> {
        guard isIdentifier(row.id) else { return .failure(.malformed) }
        if let expected = expectedConvoy, expected != row.convoy_id { return .failure(.wrongConvoy) }
        guard let kind = HazardKind(rawValue: row.kind) else { return .failure(.unknownKind) }
        guard let created = PudleTime.parse(row.created_at), let expires = PudleTime.parse(row.expires_at) else {
            return .failure(.badTimestamp)
        }
        let event = HazardEvent(id: "legacy:" + row.id, kind: kind, source: .convoyMember, convoyID: row.convoy_id,
                                reporterID: row.reporter_id, createdAt: created, expiresAt: expires, location: nil)
        return checkTimes(event, now: now, limits: limits)
    }

    public static func validate(_ row: HazardEventRow, expectedConvoy: String?, now: Date,
                                limits: EventLimits = EventLimits()) -> Result<HazardEvent, EventRejection> {
        guard isIdentifier(row.id) else { return .failure(.malformed) }
        guard row.schema_version == HazardEvent.currentSchemaVersion else { return .failure(.unsupportedSchema) }
        if let expected = expectedConvoy, expected != row.convoy_id { return .failure(.wrongConvoy) }
        guard let kind = HazardKind(rawValue: row.kind) else { return .failure(.unknownKind) }
        // The server never issues labeled tests; refuse a row that claims to be one.
        guard let source = HazardSource(rawValue: row.source), source != .labeledTest else { return .failure(.unknownSource) }
        let side: HazardSide
        if let rawSide = row.side {
            guard let parsed = HazardSide(rawValue: rawSide) else { return .failure(.malformed) }
            side = parsed
        } else {
            side = .unknown
        }
        guard let observed = PudleTime.parse(row.observed_at), let created = PudleTime.parse(row.created_at),
              let expires = PudleTime.parse(row.expires_at) else { return .failure(.badTimestamp) }
        var location: HazardLocation?
        let parts = [row.latitude, row.longitude, row.accuracy_m]
        if parts.contains(where: { $0 != nil }) {
            guard let lat = row.latitude, let lon = row.longitude, let acc = row.accuracy_m else {
                return .failure(.invalidLocation)
            }
            let candidate = HazardLocation(latitude: lat, longitude: lon, accuracyMeters: acc, headingDegrees: row.heading_deg)
            guard candidate.isValid else { return .failure(.invalidLocation) }
            location = candidate
        } else if row.heading_deg != nil {
            return .failure(.invalidLocation)
        }
        guard observed <= created.addingTimeInterval(limits.maxClockSkew) else { return .failure(.badTimestamp) }
        if source == .driverConfirmedCamera && location == nil { return .failure(.invalidLocation) }
        let event = HazardEvent(id: row.id, kind: kind, source: source, side: side, blocksRoad: row.blocks_road ?? false,
                                convoyID: row.convoy_id, reporterID: row.reporter_id,
                                observedAt: observed, createdAt: created, expiresAt: expires, location: location)
        return checkTimes(event, now: now, limits: limits)
    }

    /// Freshness rules shared by every source, including labeled test events.
    public static func checkTimes(_ event: HazardEvent, now: Date, limits: EventLimits = EventLimits()) -> Result<HazardEvent, EventRejection> {
        if event.expiresAt <= event.createdAt { return .failure(.badTimestamp) }
        if event.expiresAt.timeIntervalSince(event.createdAt) > limits.maxLifetime { return .failure(.lifetimeTooLong) }
        if event.createdAt > now.addingTimeInterval(limits.maxClockSkew) { return .failure(.createdInFuture) }
        if event.expiresAt <= now { return .failure(.expired) }
        if now.timeIntervalSince(event.observedAt) > limits.maxAge { return .failure(.tooOld) }
        return .success(event)
    }

    /// Server IDs are UUIDs; anything else (including oversized strings) is refused.
    static func isIdentifier(_ value: String) -> Bool {
        UUID(uuidString: value) != nil
    }
}
