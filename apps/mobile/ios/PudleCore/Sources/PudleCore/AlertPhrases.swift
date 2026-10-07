import Foundation

public enum DistanceUnits: String, Codable, CaseIterable, Sendable {
    case imperial
    case metric
}

/// Deterministic, reviewed spoken copy. No model or free text ever reaches speech.
/// Every phrase says who reported it; only `Relevance.ahead` uses "ahead".
public enum AlertPhrases {
    public static func label(_ kind: HazardKind) -> String {
        switch kind {
        case .tree: return "Tree or branch in road"
        case .debris: return "Debris in road"
        case .stoppedVehicle: return "Stopped vehicle"
        case .other: return "Road obstruction"
        }
    }

    static func shortLabel(_ kind: HazardKind) -> String {
        switch kind {
        case .tree: return "Tree or branch"
        case .debris: return "Debris"
        case .stoppedVehicle: return "Stopped vehicle"
        case .other: return "Obstruction"
        }
    }

    /// Distance rounded coarsely; precision would overstate what a report knows.
    public static func spokenDistance(_ meters: Double, units: DistanceUnits) -> String {
        switch units {
        case .metric:
            if meters < 1_000 {
                let rounded = max(100, (meters / 100).rounded() * 100)
                return "about \(Int(rounded)) meters"
            }
            let km = (meters / 500).rounded() / 2
            return km == km.rounded() ? "about \(Int(km)) kilometers" : "about \(String(format: "%.1f", km)) kilometers"
        case .imperial:
            let feet = meters * 3.28084
            if feet < 1_000 {
                let rounded = max(100, (feet / 100).rounded() * 100)
                return "about \(Int(rounded)) feet"
            }
            let miles = meters / 1_609.344
            if miles < 0.375 { return "about a quarter mile" }
            if miles < 0.75 { return "about half a mile" }
            let halves = (miles * 2).rounded() / 2
            if halves == 1 { return "about 1 mile" }
            return halves == halves.rounded() ? "about \(Int(halves)) miles" : "about \(String(format: "%.1f", halves)) miles"
        }
    }

    /// Returns nil when the relevance says the event must not be spoken.
    public static func phrase(for event: HazardEvent, relevance: Relevance, units: DistanceUnits) -> String? {
        if event.source == .labeledTest {
            return testPhrase(event, relevance: relevance, units: units)
        }
        let what = label(event.kind)
        switch relevance {
        case .unlocated:
            return "Pudle. \(what), reported by a convoy member. Location not verified."
        case .receiverUnknown:
            return "Pudle. \(what), reported by a convoy member. Your position is unavailable, so location is not verified."
        case .nearbyDirectionUnverified:
            return "Pudle. \(what), reported nearby by a convoy member. Direction not verified."
        case .ahead(let meters):
            return "Pudle. \(shortLabel(event.kind)) reported \(spokenDistance(meters, units: units)) ahead on your heading, by a convoy member."
        case .notRelevant:
            return nil
        }
    }

    static func testPhrase(_ event: HazardEvent, relevance: Relevance, units: DistanceUnits) -> String? {
        let what = shortLabel(event.kind)
        switch relevance {
        case .notRelevant:
            return nil
        case .ahead(let meters):
            return "Pudle test alert. \(what), \(spokenDistance(meters, units: units)) ahead. This is a demo, not a real report."
        default:
            return "Pudle test alert. \(what). This is a demo, not a real report."
        }
    }

    // Lifecycle phrases.
    public static let driveStarted = "Pudle drive started. Spoken reports are on."
    public static let driveStartedForegroundOnly = "Pudle drive started. Reports will only be spoken while Pudle is open."
    public static let driveStopped = "Pudle drive stopped."
    public static let feedLost = "Pudle has lost its connection. New reports cannot arrive."
    public static let feedRestored = "Pudle is reconnected."
}
