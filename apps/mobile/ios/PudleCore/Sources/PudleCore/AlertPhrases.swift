import Foundation

public enum DistanceUnits: String, Codable, CaseIterable, Sendable {
    case imperial
    case metric
}

/// Voice personalities. The wording changes a little; the facts never do.
public enum Persona: String, Codable, CaseIterable, Sendable {
    case copilot, buddy, pro, hype

    public var displayName: String {
        switch self {
        case .copilot: return "Calm co-pilot"
        case .buddy: return "Chill buddy"
        case .pro: return "Professional"
        case .hype: return "Hype"
        }
    }

    var opener: String {
        switch self {
        case .copilot: return "Heads up."
        case .buddy: return "Yo, heads up."
        case .pro: return "Caution."
        case .hype: return "Whoa, heads up!"
        }
    }
}

/// Deterministic, reviewed spoken copy. No model or free text ever reaches speech.
/// Rules: every report phrase says who reported it; only `Relevance.ahead` says "ahead" or a
/// distance; blockages are always "possible".
public enum AlertPhrases {
    public static func label(_ kind: HazardKind) -> String {
        switch kind {
        case .tree: return "Tree or branch in road"
        case .debris: return "Debris in road"
        case .stoppedVehicle: return "Stopped vehicle"
        case .animal: return "Animal on road"
        case .pothole: return "Large pothole"
        case .object: return "Object in road"
        case .other: return "Road obstruction"
        }
    }

    public static func noun(_ kind: HazardKind) -> String {
        switch kind {
        case .tree: return "a fallen branch"
        case .debris: return "some debris"
        case .stoppedVehicle: return "a stopped vehicle"
        case .animal: return "an animal"
        case .pothole: return "a big pothole"
        case .object: return "something"
        case .other: return "an obstruction"
        }
    }

    static func bareNoun(_ kind: HazardKind) -> String {
        switch kind {
        case .tree: return "fallen branch"
        case .debris: return "debris"
        case .stoppedVehicle: return "stopped vehicle"
        case .animal: return "animal"
        case .pothole: return "pothole"
        case .object: return "object"
        case .other: return "obstruction"
        }
    }

    static func capitalized(_ text: String) -> String {
        text.prefix(1).uppercased() + text.dropFirst()
    }

    static func sidePhrase(_ side: HazardSide) -> String? {
        switch side {
        case .left: return "on the left side of the road"
        case .right: return "on the right side of the road"
        case .center: return "in the middle of the lane"
        case .unknown: return nil
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
            if halves == 1 { return "about a mile" }
            return halves == halves.rounded() ? "about \(Int(halves)) miles" : "about \(String(format: "%.1f", halves)) miles"
        }
    }

    // MARK: Receiving a report

    /// Returns nil when the relevance says the event must not be spoken.
    public static func phrase(for event: HazardEvent, relevance: Relevance, units: DistanceUnits,
                              persona: Persona = .copilot) -> String? {
        if case .notRelevant = relevance { return nil }
        if event.source == .labeledTest { return testPhrase(event, relevance: relevance, units: units) }
        let who = event.source == .driverConfirmedCamera ? "a Pudle driver" : "a convoy member"
        let what = noun(event.kind)
        let side = sidePhrase(event.side).map { " " + $0 } ?? ""

        switch relevance {
        case .ahead(let meters, _):
            let distance = spokenDistance(meters, units: units)
            if event.blocksRoad {
                return "\(persona.opener) Possible road blockage \(distance) ahead: \(what), reported by \(who). You might want to reroute."
            }
            return "\(persona.opener) \(capitalized(what))\(side), \(distance) ahead, reported by \(who)."
        case .nearbyDirectionUnverified:
            let blockage = event.blocksRoad ? ", possibly blocking the road" : ""
            return "\(persona.opener) \(capitalized(what)) reported nearby by \(who)\(blockage). Direction not verified."
        case .receiverUnknown:
            return "\(persona.opener) \(label(event.kind)), reported by \(who). Your position is unavailable, so location is not verified."
        case .unlocated:
            return "Pudle. \(label(event.kind)), reported by \(who). Location not verified."
        case .notRelevant:
            return nil
        }
    }

    static func testPhrase(_ event: HazardEvent, relevance: Relevance, units: DistanceUnits) -> String? {
        let what = capitalized(noun(event.kind))
        if case .ahead(let meters, _) = relevance {
            return "Pudle test alert. \(what), \(spokenDistance(meters, units: units)) ahead. This is a demo, not a real report."
        }
        return "Pudle test alert. \(what). This is a demo, not a real report."
    }

    // MARK: Own camera (the detecting car)

    /// Asked after the dashcam model flags a possible hazard. The driver answers by voice.
    public static func cameraPrompt(kind: HazardKind, side: HazardSide, blocksRoad: Bool, persona: Persona) -> String {
        let what = noun(kind)
        if blocksRoad {
            return "\(persona.opener) Looks like \(what) might be blocking the road ahead. Want me to warn drivers behind you so they can take another route? Say report it, or cancel."
        }
        let side = sidePhrase(side).map { " " + $0 } ?? ""
        return "\(persona.opener) Possible \(bareNoun(kind))\(side) coming up, in case you didn't notice. Want me to warn drivers behind you? Say report it, or cancel."
    }

    public static func reportSent(blocksRoad: Bool) -> String {
        blocksRoad ? "Done. I warned drivers behind you about a possible blockage." : "Done. I warned drivers behind you."
    }
    public static let reportCancelled = "Okay, not reporting it."
    public static let reportFailed = "Sorry, I couldn't send that report. Check the connection."
    public static let noAnswer = "I didn't catch that, so I won't report it."

    // Lifecycle phrases.
    public static let driveStarted = "Pudle drive started. Spoken reports are on."
    public static let driveStartedForegroundOnly = "Pudle drive started. Reports will only be spoken while Pudle is open."
    public static let driveStopped = "Pudle drive stopped."
    public static let feedLost = "Pudle has lost its connection. New reports cannot arrive."
    public static let feedRestored = "Pudle is reconnected."
}

/// Deterministic yes/no understanding of the driver's spoken answer.
public enum VoiceIntent: Equatable, Sendable {
    case confirm, cancel, unknown

    public static func parse(_ transcript: String) -> VoiceIntent {
        let words = transcript.lowercased()
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
        let text = " " + words.joined(separator: " ") + " "
        // Negatives first: "don't report it" must not count as "report it".
        let negatives = [" no ", " nope ", " nah ", " cancel ", " don t ", " dont ", " do not ", " never mind ", " nevermind ",
                         " stop ", " ignore ", " skip "]
        if negatives.contains(where: { text.contains($0) }) { return .cancel }
        let positives = [" yes ", " yeah ", " yep ", " yup ", " sure ", " report ", " go ahead ", " do it ", " send ",
                         " warn ", " ok ", " okay ", " please ", " affirmative "]
        if positives.contains(where: { text.contains($0) }) { return .confirm }
        return .unknown
    }
}
