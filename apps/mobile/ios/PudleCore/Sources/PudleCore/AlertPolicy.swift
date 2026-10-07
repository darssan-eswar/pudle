import Foundation

public enum SuppressReason: Equatable, Sendable {
    case driveNotActive
    case muted
    case duplicate
    case similarRecentlyAnnounced
    case ownReport
    case rejected(EventRejection)
    case notRelevant(String)
    case rateLimited
}

public enum AlertDecision: Equatable, Sendable {
    case speak(phrase: String, relevance: Relevance)
    case suppress(SuppressReason)
}

/// Decides, deterministically, whether an incoming event may be spoken.
/// Pure value type: the app feeds it events from every delivery path (poll, test,
/// future push) so duplicates arriving by different routes are spoken at most once.
public struct AlertPolicy: Sendable {
    public var isActive = false
    public var isMuted = false
    public var units: DistanceUnits = .imperial
    public var ownUserID: String?
    public var limits = EventLimits()
    public var rules = RelevanceRules()
    /// At most this many spoken alerts per rolling minute.
    public var maxPerMinute = 4
    /// Same kind within this distance and time counts as the same hazard.
    public var similarRadiusMeters = 200.0
    public var similarWindow: TimeInterval = 120

    private var seen: [String: Date] = [:]
    private var spoken: [(kind: HazardKind, location: HazardLocation?, at: Date)] = []

    public init() {}

    public var seenCount: Int { seen.count }

    public mutating func decide(_ event: HazardEvent, receiver: ReceiverFix?, now: Date) -> AlertDecision {
        prune(now: now)
        guard isActive else { return .suppress(.driveNotActive) }
        if seen[event.id] != nil { return .suppress(.duplicate) }
        if case .failure(let reason) = EventDecoder.checkTimes(event, now: now, limits: limits) {
            return .suppress(.rejected(reason))
        }
        // From here on the event is consumed, even if muted: unmuting never replays.
        seen[event.id] = event.expiresAt
        if event.source != .labeledTest, let me = ownUserID, event.reporterID == me {
            return .suppress(.ownReport)
        }
        if isMuted { return .suppress(.muted) }

        let relevance = RoadRelevance.evaluate(hazard: event.location, receiver: receiver, now: now, rules: rules)
        if case .notRelevant(let why) = relevance { return .suppress(.notRelevant(why)) }
        if isSimilarToRecent(event, now: now) { return .suppress(.similarRecentlyAnnounced) }
        if spoken.filter({ now.timeIntervalSince($0.at) < 60 }).count >= maxPerMinute {
            return .suppress(.rateLimited)
        }
        guard let phrase = AlertPhrases.phrase(for: event, relevance: relevance, units: units) else {
            return .suppress(.notRelevant("no phrase"))
        }
        spoken.append((event.kind, event.location, now))
        return .speak(phrase: phrase, relevance: relevance)
    }

    /// Ends a drive: forget per-drive history so nothing carries into the next drive.
    public mutating func reset() {
        seen.removeAll()
        spoken.removeAll()
    }

    private func isSimilarToRecent(_ event: HazardEvent, now: Date) -> Bool {
        if event.source == .labeledTest { return false }
        return spoken.contains { previous in
            guard previous.kind == event.kind, now.timeIntervalSince(previous.at) < similarWindow else { return false }
            switch (previous.location, event.location) {
            case (nil, nil):
                return true  // two unlocated reports of the same kind: corroboration, not news
            case let (a?, b?):
                return Geo.distance(lat1: a.latitude, lon1: a.longitude, lat2: b.latitude, lon2: b.longitude) <= similarRadiusMeters
            default:
                return false
            }
        }
    }

    private mutating func prune(now: Date) {
        // Keep IDs a little past expiry so a late duplicate is still recognized.
        seen = seen.filter { $0.value.addingTimeInterval(limits.maxClockSkew + 60) > now }
        spoken.removeAll { now.timeIntervalSince($0.at) > max(similarWindow, 60) }
    }
}
