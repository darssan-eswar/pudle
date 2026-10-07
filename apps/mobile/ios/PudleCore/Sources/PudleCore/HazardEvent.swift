import Foundation

/// Hazard categories Pudle can speak about. Raw values match the database `kind` check.
/// Unknown strings are rejected; free text is never spoken.
public enum HazardKind: String, Codable, CaseIterable, Sendable {
    case tree            // fallen tree or branch
    case debris
    case stoppedVehicle = "stopped_vehicle"
    case animal
    case pothole
    case object
    case other
}

/// Where a report came from. Spoken copy always reflects provenance.
public enum HazardSource: String, Codable, Sendable {
    /// A signed-in convoy member tapped it in (passenger or parked).
    case convoyMember = "convoy_member"
    /// The reporter's dashcam model flagged a possible hazard AND the driver confirmed it by voice or tap.
    case driverConfirmedCamera = "driver_confirmed_camera"
    /// A synthetic, clearly labeled event used to demonstrate the alert lifecycle.
    case labeledTest = "labeled_test"
}

/// Which side of the reporter's lane the hazard was on.
public enum HazardSide: String, Codable, CaseIterable, Sendable {
    case left, right, center, unknown
}

/// A consented position attached to a report. Optional: many reports have none.
public struct HazardLocation: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    /// Horizontal accuracy radius in meters reported by the sender's device.
    public var accuracyMeters: Double
    /// Sender's direction of travel in degrees (0 = north), when known and moving.
    public var headingDegrees: Double?

    public init(latitude: Double, longitude: Double, accuracyMeters: Double, headingDegrees: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyMeters = accuracyMeters
        self.headingDegrees = headingDegrees
    }

    public var isValid: Bool {
        guard latitude.isFinite, longitude.isFinite, accuracyMeters.isFinite else { return false }
        guard (-90...90).contains(latitude), (-180...180).contains(longitude) else { return false }
        guard accuracyMeters > 0, accuracyMeters <= 1_000 else { return false }
        if let heading = headingDegrees {
            guard heading.isFinite, heading >= 0, heading < 360 else { return false }
        }
        return true
    }
}

/// Versioned hazard event (schema v1). Legacy `obstacle_reports` rows map to this
/// with `location == nil`.
public struct HazardEvent: Equatable, Sendable, Identifiable {
    public static let currentSchemaVersion = 1

    public var id: String
    public var schemaVersion: Int
    public var kind: HazardKind
    public var source: HazardSource
    public var side: HazardSide
    /// Reporter believed it may block the road. Always spoken as "possible".
    public var blocksRoad: Bool
    public var convoyID: String?
    public var reporterID: String?
    /// When the reporter observed the hazard (defaults to createdAt).
    public var observedAt: Date
    /// When the server accepted it.
    public var createdAt: Date
    public var expiresAt: Date
    public var location: HazardLocation?

    public init(id: String, schemaVersion: Int = HazardEvent.currentSchemaVersion, kind: HazardKind,
                source: HazardSource, side: HazardSide = .unknown, blocksRoad: Bool = false,
                convoyID: String? = nil, reporterID: String? = nil,
                observedAt: Date? = nil, createdAt: Date, expiresAt: Date, location: HazardLocation? = nil) {
        self.id = id
        self.schemaVersion = schemaVersion
        self.kind = kind
        self.source = source
        self.side = side
        self.blocksRoad = blocksRoad
        self.convoyID = convoyID
        self.reporterID = reporterID
        self.observedAt = observedAt ?? createdAt
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.location = location
    }
}
