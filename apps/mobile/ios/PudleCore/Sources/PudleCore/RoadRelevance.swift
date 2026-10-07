import Foundation

/// The receiving phone's own position, kept on-device only.
public struct ReceiverFix: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var accuracyMeters: Double
    /// Course over ground in degrees; nil or negative when unknown.
    public var courseDegrees: Double?
    public var speedMetersPerSecond: Double?
    public var timestamp: Date

    public init(latitude: Double, longitude: Double, accuracyMeters: Double, courseDegrees: Double?,
                speedMetersPerSecond: Double?, timestamp: Date) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyMeters = accuracyMeters
        self.courseDegrees = courseDegrees
        self.speedMetersPerSecond = speedMetersPerSecond
        self.timestamp = timestamp
    }
}

/// How a hazard relates to the receiver. Only `.ahead` permits words like "ahead".
public enum Relevance: Equatable, Sendable {
    /// No position on the report: speak it as a general convoy report, never as ahead.
    case unlocated
    /// Report has a position, but this phone's own position/course is missing, stale or
    /// too inaccurate to relate them. Speak as a general report with "location not verified".
    case receiverUnknown(String)
    /// Close by, but direction of travel cannot be confirmed (stationary, no heading,
    /// or position uncertainty too large). Never phrased as ahead.
    case nearbyDirectionUnverified(distanceMeters: Double)
    /// In front of the receiver, on a matching heading, close to its line of travel.
    /// Still a *report*: Pudle has no map matching, so bridges or very close parallel
    /// lanes cannot be excluded. Copy says "on your heading", not "in your lane".
    case ahead(distanceMeters: Double)
    /// Should not be spoken: far away, behind, already passed, or opposite direction.
    case notRelevant(String)
}

public struct RelevanceRules: Sendable {
    public var maxFixAge: TimeInterval = 15
    public var maxReceiverAccuracy: Double = 50
    public var maxHazardAccuracyForAhead: Double = 40
    public var minSpeedForCourse: Double = 3          // ~11 km/h; below this, course is noise
    public var nearbyRadius: Double = 500
    public var aheadMaxDistance: Double = 3_000
    public var aheadMaxBearingOffset: Double = 25     // degrees from receiver course
    public var maxHeadingDifference: Double = 45      // sender heading vs receiver course
    public var maxCrossTrack: Double = 30             // meters from the receiver's line of travel
    public var oppositeHeadingThreshold: Double = 135
    public init() {}
}

public enum Geo {
    static let earthRadius = 6_371_008.8

    public static func distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
    }

    public static func bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dl = (lon2 - lon1) * .pi / 180
        let y = sin(dl) * cos(p2)
        let x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        let degrees = atan2(y, x) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Smallest absolute difference between two headings, 0...180.
    public static func angleDifference(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return d > 180 ? 360 - d : d
    }
}

public enum RoadRelevance {
    public static func evaluate(hazard: HazardLocation?, receiver: ReceiverFix?, now: Date,
                                rules: RelevanceRules = RelevanceRules()) -> Relevance {
        guard let hazard, hazard.isValid else { return .unlocated }
        guard let receiver else { return .receiverUnknown("no position") }
        if now.timeIntervalSince(receiver.timestamp) > rules.maxFixAge { return .receiverUnknown("stale position") }
        if receiver.accuracyMeters <= 0 || receiver.accuracyMeters > rules.maxReceiverAccuracy {
            return .receiverUnknown("low accuracy")
        }

        let distance = Geo.distance(lat1: receiver.latitude, lon1: receiver.longitude,
                                    lat2: hazard.latitude, lon2: hazard.longitude)
        let moving = (receiver.speedMetersPerSecond ?? 0) >= rules.minSpeedForCourse
        let course = receiver.courseDegrees.flatMap { $0 >= 0 && $0 < 360 ? $0 : nil }

        guard moving, let course else {
            return distance <= rules.nearbyRadius
                ? .nearbyDirectionUnverified(distanceMeters: distance)
                : .notRelevant("far while course unknown")
        }
        if distance > rules.aheadMaxDistance { return .notRelevant("far") }

        let bearing = Geo.bearing(lat1: receiver.latitude, lon1: receiver.longitude,
                                  lat2: hazard.latitude, lon2: hazard.longitude)
        let offset = Geo.angleDifference(bearing, course)
        // Within the combined uncertainty the hazard may be at our position; treat as passing.
        let uncertainty = hazard.accuracyMeters + receiver.accuracyMeters
        if offset > 90 && distance > uncertainty { return .notRelevant("behind or passed") }

        if let senderHeading = hazard.headingDegrees,
           Geo.angleDifference(senderHeading, course) >= rules.oppositeHeadingThreshold {
            return .notRelevant("opposite direction")
        }

        let crossTrack = abs(sin(offset * .pi / 180) * distance)
        let headingMatches = hazard.headingDegrees.map {
            Geo.angleDifference($0, course) <= rules.maxHeadingDifference
        } ?? false

        if headingMatches, offset <= rules.aheadMaxBearingOffset, crossTrack <= rules.maxCrossTrack + hazard.accuracyMeters,
           hazard.accuracyMeters <= rules.maxHazardAccuracyForAhead, distance > uncertainty {
            return .ahead(distanceMeters: distance)
        }
        if distance <= rules.nearbyRadius { return .nearbyDirectionUnverified(distanceMeters: distance) }
        return .notRelevant("not on heading")
    }
}
