import Foundation

public enum LocationAccess: String, Sendable {
    case notDetermined, denied, restricted, whenInUse, always
}

public enum FeedState: Equatable, Sendable {
    /// No convoy/backend configured: only labeled test events can arrive.
    case notConfigured
    case signedOut
    case connecting
    case live(lastSuccess: Date)
    /// Requests are failing; reports may be missed.
    case degraded(String)
    case offline
}

public enum DrivePhase: String, Sendable {
    case stopped, active
}

/// Everything the status screen needs, collected so wording can be unit-tested.
public struct DriveSnapshot: Sendable {
    public var phase: DrivePhase
    public var muted: Bool
    public var location: LocationAccess
    public var backgroundLocationRunning: Bool
    public var notificationsAllowed: Bool
    public var feed: FeedState

    public init(phase: DrivePhase, muted: Bool, location: LocationAccess, backgroundLocationRunning: Bool,
                notificationsAllowed: Bool, feed: FeedState) {
        self.phase = phase
        self.muted = muted
        self.location = location
        self.backgroundLocationRunning = backgroundLocationRunning
        self.notificationsAllowed = notificationsAllowed
        self.feed = feed
    }
}

public enum StatusTone: String, Sendable { case good, warning, problem, neutral }

public struct StatusLine: Equatable, Sendable {
    public var title: String
    public var detail: String
    public var tone: StatusTone
}

/// Honest, plain-language status. Missing data is never presented as "all clear".
public enum DriveStatusText {
    public static func headline(_ s: DriveSnapshot) -> StatusLine {
        guard s.phase == .active else {
            return StatusLine(title: "Not driving", detail: "Pudle is not collecting location or speaking reports.", tone: .neutral)
        }
        if s.muted {
            return StatusLine(title: "Drive active · Muted", detail: "Reports are still received but not spoken. Muted reports are not replayed.", tone: .warning)
        }
        if !s.backgroundLocationRunning {
            return StatusLine(title: "Drive active · Pudle must stay open",
                              detail: "Location access is off, so iOS will pause Pudle when you switch apps. Reports are spoken only while Pudle is on screen.",
                              tone: .problem)
        }
        switch s.feed {
        case .offline:
            return StatusLine(title: "Drive active · Offline",
                              detail: "No connection. New reports cannot arrive. This is not an all-clear.", tone: .problem)
        case .degraded(let why):
            return StatusLine(title: "Drive active · Connection problem",
                              detail: "Reports may be missed (\(why)). This is not an all-clear.", tone: .problem)
        case .notConfigured, .signedOut:
            return StatusLine(title: "Drive active · Test mode",
                              detail: "No convoy connected. Only labeled test alerts will be spoken.", tone: .warning)
        case .connecting:
            return StatusLine(title: "Drive active · Connecting", detail: "Waiting for the report feed.", tone: .warning)
        case .live:
            return StatusLine(title: "Drive active · Listening",
                              detail: "Convoy reports will be spoken, including while another app is open.", tone: .good)
        }
    }

    public static func feedDetail(_ feed: FeedState, now: Date) -> String {
        switch feed {
        case .notConfigured: return "Backend not configured in this build"
        case .signedOut: return "Signed out"
        case .connecting: return "Connecting…"
        case .live(let last):
            let age = max(0, Int(now.timeIntervalSince(last)))
            return "Live · checked \(age)s ago"
        case .degraded(let why): return "Degraded · \(why)"
        case .offline: return "Offline"
        }
    }
}

/// Delivery evidence for the diagnostics log and the device test matrix.
/// Contains no coordinates, names or report text beyond the fixed category.
public struct DeliveryRecord: Identifiable, Equatable, Sendable {
    public enum Outcome: String, Sendable {
        case spoken, notified, suppressed, failed
    }
    public var id = UUID()
    public var eventID: String
    public var kind: HazardKind
    public var source: HazardSource
    public var receivedAt: Date
    public var finishedAt: Date?
    public var appState: String
    public var outcome: Outcome
    public var note: String

    public init(eventID: String, kind: HazardKind, source: HazardSource, receivedAt: Date, finishedAt: Date? = nil,
                appState: String, outcome: Outcome, note: String) {
        self.eventID = eventID
        self.kind = kind
        self.source = source
        self.receivedAt = receivedAt
        self.finishedAt = finishedAt
        self.appState = appState
        self.outcome = outcome
        self.note = note
    }

    /// Created-to-speech-start latency, the user-visible figure.
    public static func latency(from created: Date, to spoken: Date) -> TimeInterval {
        spoken.timeIntervalSince(created)
    }
}

public enum LatencyStats {
    /// Nearest-rank percentile; returns nil for empty input.
    public static func percentile(_ values: [Double], _ p: Double) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let rank = Int((p / 100 * Double(sorted.count)).rounded(.up))
        return sorted[min(max(rank, 1), sorted.count) - 1]
    }
}
