import Foundation

public enum SuppressReason: Equatable, Sendable {
    case driveNotActive
    case muted
    case duplicate
    case similarRecentlyAnnounced
    case ownReport
    case rejected(EventRejection)
    /// Not relevant *yet*. The event is not consumed: it is re-checked on the next update,
    /// so a report first seen too far away is still spoken when the car approaches.
    case notRelevantYet(String)
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
    public var persona: Persona = .copilot
    public var ownUserID: String?
    public var corridor: RoadCorridor?
    public var limits = EventLimits()
    public var rules = RelevanceRules()
    /// At most this many spoken alerts per rolling minute.
    public var maxPerMinute = 4
    /// Same kind within this distance and time counts as the same hazard.
    public var similarRadiusMeters = 200.0
    public var similarWindow: TimeInterval = 120

    /// Events that reached a final outcome (spoken, muted, own, rejected): never re-evaluated.
    private var consumed: [String: Date] = [:]
    private var spoken: [(kind: HazardKind, location: HazardLocation?, at: Date)] = []

    public init() {}

    public var consumedCount: Int { consumed.count }

    public mutating func decide(_ event: HazardEvent, receiver: ReceiverFix?, now: Date) -> AlertDecision {
        prune(now: now)
        guard isActive else { return .suppress(.driveNotActive) }
        if consumed[event.id] != nil { return .suppress(.duplicate) }
        if case .failure(let reason) = EventDecoder.checkTimes(event, now: now, limits: limits) {
            consumed[event.id] = now.addingTimeInterval(60)
            return .suppress(.rejected(reason))
        }
        if event.source != .labeledTest, let me = ownUserID, event.reporterID == me {
            consume(event)
            return .suppress(.ownReport)
        }
        if isMuted {
            // Muting consumes: unmuting never replays a backlog.
            consume(event)
            return .suppress(.muted)
        }

        let relevance = RoadRelevance.evaluate(hazard: event.location, receiver: receiver, now: now,
                                               corridor: corridor, rules: rules)
        if case .notRelevant(let why) = relevance { return .suppress(.notRelevantYet(why)) }

        if event.source == .driverConfirmedCamera, event.location != nil {
            switch relevance {
            case .receiverUnknown, .nearbyDirectionUnverified: return .suppress(.notRelevantYet("waiting for reliable direction"))
            default: break
            }
        }

        if isSimilarToRecent(event, now: now) {
            consume(event)
            return .suppress(.similarRecentlyAnnounced)
        }
        if spoken.filter({ now.timeIntervalSince($0.at) < 60 }).count >= maxPerMinute {
            // Not consumed: it can still be spoken once the burst is over, if still relevant.
            return .suppress(.rateLimited)
        }
        guard let phrase = AlertPhrases.phrase(for: event, relevance: relevance, units: units, persona: persona) else {
            return .suppress(.notRelevantYet("no phrase"))
        }
        consume(event)
        spoken.append((event.kind, event.location, now))
        return .speak(phrase: phrase, relevance: relevance)
    }

    /// Ends a drive: forget per-drive history so nothing carries into the next drive.
    public mutating func reset() {
        consumed.removeAll()
        spoken.removeAll()
    }

    private mutating func consume(_ event: HazardEvent) {
        consumed[event.id] = event.expiresAt
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
        consumed = consumed.filter { $0.value.addingTimeInterval(limits.maxClockSkew + 60) > now }
        spoken.removeAll { now.timeIntervalSince($0.at) > max(similarWindow, 60) }
    }
}

/// Smooths per-frame model output into at most one prompt per real-world hazard.
/// A hazard is accepted after 2 agreeing frames within `window`, or 1 very confident frame.
public struct DetectionFilter: Sendable {
    public struct Observation: Equatable, Sendable {
        public var kind: HazardKind
        public var side: HazardSide
        public var blocksRoad: Bool
        public var confidence: Double
        public var at: Date
        public init(kind: HazardKind, side: HazardSide, blocksRoad: Bool, confidence: Double, at: Date) {
            self.kind = kind; self.side = side; self.blocksRoad = blocksRoad; self.confidence = confidence; self.at = at
        }
    }

    public var minConfidence = 0.55
    public var singleFrameConfidence = 0.85
    public var window: TimeInterval = 5
    /// After a prompt, ignore detections for this long (the same object stays in view).
    public var cooldown: TimeInterval = 30
    private var recent: [Observation] = []
    private var lastAcceptedAt: Date?

    public init() {}

    /// Feed one frame result (`nil` = model saw no hazard). Returns an observation to act on, or nil.
    public mutating func add(_ observation: Observation?, now: Date) -> Observation? {
        recent.removeAll { now.timeIntervalSince($0.at) > window }
        if let last = lastAcceptedAt, now.timeIntervalSince(last) < cooldown { return nil }
        guard let observation, observation.confidence >= minConfidence else { return nil }
        recent.append(observation)
        let agreeing = recent.filter { $0.kind == observation.kind || Self.related($0.kind, observation.kind) }
        if observation.confidence >= singleFrameConfidence || agreeing.count >= 2 {
            lastAcceptedAt = now
            recent.removeAll()
            // The latest frame matches the position/time captured by the caller.
            return observation
        }
        return nil
    }

    public mutating func reset() {
        recent.removeAll()
        lastAcceptedAt = nil
    }

    static func related(_ a: HazardKind, _ b: HazardKind) -> Bool {
        let loose: Set<HazardKind> = [.tree, .debris, .object, .other]
        return loose.contains(a) && loose.contains(b)
    }
}
