import Foundation

/// The receiving phone's own position, kept on-device only.
public struct ReceiverFix: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var accuracyMeters: Double
    /// Course over ground in degrees; nil when unknown. The app fills it from GPS course or,
    /// when that is invalid (slow driving), from the bearing between recent fixes.
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
    /// Report has a position, but this phone's own position is missing, stale or too inaccurate.
    case receiverUnknown(String)
    /// Close by, but direction of travel cannot be confirmed. Never phrased as ahead.
    case nearbyDirectionUnverified(distanceMeters: Double)
    /// In front of the receiver on the same road and direction (corridor match), or on a matching
    /// heading close to its line of travel (no corridor). Still a *report*.
    case ahead(distanceMeters: Double, onRecordedRoad: Bool)
    /// Should not be spoken now: far away, behind, passed, opposite direction or off the road.
    /// Not final: the receiver may approach later, so the policy re-checks it on every update.
    case notRelevant(String)
}

public struct RelevanceRules: Sendable {
    public var maxFixAge: TimeInterval = 15
    public var maxReceiverAccuracy: Double = 50
    public var maxHazardAccuracyForAhead: Double = 40
    /// Below this speed, `courseDegrees` must come from recent fixes (the app derives it).
    public var minSpeedForCourse: Double = 1.0            // ~2 mph: slow demo driving still counts
    public var nearbyRadius: Double = 500
    /// "Within about a mile": warn up to one mile ahead along the road.
    public var aheadMaxDistance: Double = 1_609.344
    public var aheadMaxBearingOffset: Double = 25
    public var maxHeadingDifference: Double = 45
    public var maxCrossTrack: Double = 30
    public var oppositeHeadingThreshold: Double = 135
    /// Max distance from the recorded road centerline to count as "on" it.
    public var corridorHalfWidth: Double = 40
    /// Receiver course must be within this of the road direction to count as same direction.
    public var corridorMaxHeadingDifference: Double = 60
    public init() {}
}

public enum Geo {
    static let earthRadius = 6_371_008.8

    public static func distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let rawA = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        let a = max(0, min(1, rawA))
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

/// A recorded road, ordered in its travel direction. Used to decide "same road, same
/// direction, N meters ahead" instead of guessing from straight-line bearings.
public struct RoadCorridor: Equatable, Sendable {
    public struct Point: Equatable, Sendable {
        public var latitude: Double
        public var longitude: Double
        public init(_ latitude: Double, _ longitude: Double) { self.latitude = latitude; self.longitude = longitude }
    }

    public struct Projection: Equatable, Sendable {
        /// Distance along the road from its start to the projected point.
        public var alongMeters: Double
        /// Perpendicular distance from the road centerline.
        public var offsetMeters: Double
        /// Road direction at that point.
        public var bearingDegrees: Double
    }

    public var id: String
    public var name: String
    public var points: [Point]
    private var cumulative: [Double]

    public init?(id: String, name: String, points: [Point]) {
        guard points.count >= 2 else { return nil }
        self.id = id
        self.name = name
        self.points = points
        var total = 0.0
        var cumulative = [0.0]
        for i in 1..<points.count {
            total += Geo.distance(lat1: points[i - 1].latitude, lon1: points[i - 1].longitude,
                                  lat2: points[i].latitude, lon2: points[i].longitude)
            cumulative.append(total)
        }
        guard total > 20 else { return nil }
        self.cumulative = cumulative
    }

    public var lengthMeters: Double { cumulative.last ?? 0 }

    /// Projects a position onto the nearest corridor segment (local flat-earth approximation,
    /// accurate to well under a meter over a few hundred meters).
    public func project(latitude: Double, longitude: Double) -> Projection {
        var best = Projection(alongMeters: 0, offsetMeters: .infinity, bearingDegrees: 0)
        let metersPerDegLat = 111_320.0
        for i in 0..<(points.count - 1) {
            let a = points[i], b = points[i + 1]
            let metersPerDegLon = metersPerDegLat * cos(a.latitude * .pi / 180)
            let bx = (b.longitude - a.longitude) * metersPerDegLon, by = (b.latitude - a.latitude) * metersPerDegLat
            let px = (longitude - a.longitude) * metersPerDegLon, py = (latitude - a.latitude) * metersPerDegLat
            let lengthSquared = bx * bx + by * by
            let t = lengthSquared > 0 ? max(0, min(1, (px * bx + py * by) / lengthSquared)) : 0
            let dx = px - t * bx, dy = py - t * by
            let offset = sqrt(dx * dx + dy * dy)
            if offset < best.offsetMeters {
                let segment = cumulative[i + 1] - cumulative[i]
                best = Projection(alongMeters: cumulative[i] + t * segment, offsetMeters: offset,
                                  bearingDegrees: Geo.bearing(lat1: a.latitude, lon1: a.longitude,
                                                              lat2: b.latitude, lon2: b.longitude))
            }
        }
        return best
    }
}

public enum RoadRelevance {
    public static func evaluate(hazard: HazardLocation?, receiver: ReceiverFix?, now: Date,
                                corridor: RoadCorridor? = nil,
                                rules: RelevanceRules = RelevanceRules()) -> Relevance {
        guard let hazard, hazard.isValid else { return .unlocated }
        guard let receiver else { return .receiverUnknown("no position") }
        guard receiver.latitude.isFinite, receiver.longitude.isFinite, (-90...90).contains(receiver.latitude), (-180...180).contains(receiver.longitude), receiver.accuracyMeters.isFinite, receiver.timestamp.timeIntervalSince(now) <= 5 else { return .receiverUnknown("invalid position") }
        if now.timeIntervalSince(receiver.timestamp) > rules.maxFixAge { return .receiverUnknown("stale position") }
        if receiver.accuracyMeters <= 0 || receiver.accuracyMeters > rules.maxReceiverAccuracy {
            return .receiverUnknown("low accuracy")
        }

        let distance = Geo.distance(lat1: receiver.latitude, lon1: receiver.longitude,
                                    lat2: hazard.latitude, lon2: hazard.longitude)
        let moving = (receiver.speedMetersPerSecond ?? 0) >= rules.minSpeedForCourse
        let course = receiver.courseDegrees.flatMap { $0 >= 0 && $0 < 360 ? $0 : nil }

        // 1. Recorded road: the strongest evidence for "same road, same direction".
        if let corridor {
            let h = corridor.project(latitude: hazard.latitude, longitude: hazard.longitude)
            let r = corridor.project(latitude: receiver.latitude, longitude: receiver.longitude)
            let hazardOnRoad = h.offsetMeters <= rules.corridorHalfWidth + hazard.accuracyMeters
            let receiverOnRoad = r.offsetMeters <= rules.corridorHalfWidth + receiver.accuracyMeters
            if hazardOnRoad && receiverOnRoad {
                guard hazard.accuracyMeters <= rules.maxHazardAccuracyForAhead else { return .notRelevant("report position uncertain") }
                if let heading = hazard.headingDegrees, Geo.angleDifference(heading, h.bearingDegrees) > rules.corridorMaxHeadingDifference { return .notRelevant("report direction differs from road") }
                guard moving, let course else {
                    return distance <= rules.nearbyRadius
                        ? .nearbyDirectionUnverified(distanceMeters: distance)
                        : .notRelevant("on road, direction unknown")
                }
                let headingDiff = Geo.angleDifference(course, r.bearingDegrees)
                if headingDiff >= 180 - rules.corridorMaxHeadingDifference { return .notRelevant("opposite direction") }
                if headingDiff > rules.corridorMaxHeadingDifference { return .notRelevant("crossing the road") }
                let ahead = h.alongMeters - r.alongMeters
                let slack = hazard.accuracyMeters + receiver.accuracyMeters
                if ahead <= -slack { return .notRelevant("behind or passed") }
                if ahead > rules.aheadMaxDistance { return .notRelevant("not yet in range") }
                if ahead <= slack { return .nearbyDirectionUnverified(distanceMeters: max(distance, 0)) }
                return .ahead(distanceMeters: ahead, onRecordedRoad: true)
            }
            if hazardOnRoad && !receiverOnRoad && distance <= rules.aheadMaxDistance {
                // The hazard is on the recorded road but we are not: likely a parallel or crossing street.
                return distance <= 150 ? .nearbyDirectionUnverified(distanceMeters: distance) : .notRelevant("off the recorded road")
            }
            return .notRelevant("outside selected recorded road")
        }

        // 2. No usable corridor: bearing and heading heuristics. Cannot exclude parallel roads
        //    precisely, so it requires a sender heading and tight geometry.
        guard moving, let course else {
            return distance <= rules.nearbyRadius
                ? .nearbyDirectionUnverified(distanceMeters: distance)
                : .notRelevant("far while course unknown")
        }
        if distance > rules.aheadMaxDistance { return .notRelevant("far") }

        let bearing = Geo.bearing(lat1: receiver.latitude, lon1: receiver.longitude,
                                  lat2: hazard.latitude, lon2: hazard.longitude)
        let offset = Geo.angleDifference(bearing, course)
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
            return .ahead(distanceMeters: distance, onRecordedRoad: false)
        }
        if distance <= rules.nearbyRadius { return .nearbyDirectionUnverified(distanceMeters: distance) }
        return .notRelevant("not on heading")
    }
}

/// Derives a course from recent fixes when the GPS course is invalid (common below ~5 mph).
public enum CourseEstimator {
    /// `fixes` oldest first. Uses the newest fix and the most recent earlier fix at least
    /// `minDistance` away, both reasonably accurate.
    public static func course(from fixes: [ReceiverFix], minDistance: Double = 12, maxAge: TimeInterval = 20) -> Double? {
        guard let last = fixes.last, last.accuracyMeters <= 30 else { return nil }
        for previous in fixes.dropLast().reversed() {
            if last.timestamp.timeIntervalSince(previous.timestamp) > maxAge { break }
            guard previous.accuracyMeters <= 30 else { continue }
            let d = Geo.distance(lat1: previous.latitude, lon1: previous.longitude, lat2: last.latitude, lon2: last.longitude)
            if d >= minDistance {
                return Geo.bearing(lat1: previous.latitude, lon1: previous.longitude, lat2: last.latitude, lon2: last.longitude)
            }
        }
        return nil
    }
}
