import Foundation
import Network
import SwiftUI
import UIKit
import PudleCore

struct DiagnosticLine: Identifiable {
    let id = UUID()
    let at: Date
    let text: String
}

/// Orchestrates one driving session: location, feed polling, alert policy and speech.
/// Every delivery path (backend poll, labeled test) goes through `handle(_:)` so the
/// same dedupe/freshness/relevance rules apply to all of them.
@MainActor
final class AppModel: ObservableObject {
    // Session
    @Published private(set) var phase: DrivePhase = .stopped
    @Published private(set) var muted = false
    @Published private(set) var driveStartedAt: Date?
    @Published private(set) var pendingTestAt: Date?

    // Capabilities
    @Published private(set) var locationAccess: LocationAccess = .notDetermined
    @Published private(set) var notificationsAllowed = false
    @Published private(set) var feed: FeedState = .notConfigured
    @Published private(set) var online = true
    @Published private(set) var audioNote: String?
    @Published private(set) var lastFix: ReceiverFix?

    // Evidence
    @Published private(set) var deliveries: [DeliveryRecord] = []
    @Published private(set) var diagnostics: [DiagnosticLine] = []

    // Account / convoy
    @Published private(set) var signedInEmail: String?
    @Published private(set) var convoys: [BackendClient.Convoy] = []
    @Published var selectedConvoyID: String? {
        didSet { UserDefaults.standard.set(selectedConvoyID, forKey: "convoyID"); refreshFeedState() }
    }
    @Published var units: DistanceUnits {
        didSet { UserDefaults.standard.set(units.rawValue, forKey: "units"); policy.units = units }
    }
    @Published var shareLocationWithReports: Bool {
        didSet { UserDefaults.standard.set(shareLocationWithReports, forKey: "shareLocation") }
    }
    @Published var lastError: String?

    let config = AppConfig.current
    private let location = LocationService()
    private let speech = SpeechService()
    private let notifications = NotificationService()
    private lazy var backend = BackendClient(config: config)
    private var policy = AlertPolicy()
    private var pollTask: Task<Void, Never>?
    private var testTask: Task<Void, Never>?
    private let pathMonitor = NWPathMonitor()
    private var batteryAtStart: Float?
    private var wasLive = false

    init() {
        let defaults = UserDefaults.standard
        units = DistanceUnits(rawValue: defaults.string(forKey: "units") ?? "") ?? (Locale.current.measurementSystem == .metric ? .metric : .imperial)
        shareLocationWithReports = defaults.bool(forKey: "shareLocation")
        selectedConvoyID = defaults.string(forKey: "convoyID")
        policy.units = units

        location.onAccessChange = { [weak self] access in self?.locationAccessChanged(access) }
        location.onFix = { [weak self] fix in self?.lastFix = fix }
        location.onError = { [weak self] message in self?.note(message) }
        notifications.onMute = { [weak self] in self?.setMuted(true) }
        notifications.onStop = { [weak self] in self?.stopDrive() }
        speech.onInterruptionChange = { [weak self] message in
            guard let self else { return }
            self.audioNote = message
            if let message { self.note(message) }
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let isOnline = path.status == .satisfied
            Task { @MainActor in self?.networkChanged(isOnline) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "pudle.network"))

        locationAccess = location.access
        signedInEmail = backend.session?.email ?? (backend.session != nil ? "Signed in" : nil)
        refreshFeedState()
        Task { await notifications.refreshPermission(); notificationsAllowed = notifications.allowed }
    }

    // MARK: Derived state

    var snapshot: DriveSnapshot {
        DriveSnapshot(phase: phase, muted: muted, location: locationAccess,
                      backgroundLocationRunning: location.canRunInBackground,
                      notificationsAllowed: notificationsAllowed, feed: feed)
    }

    var spokenLatencies: [Double] {
        deliveries.compactMap { record in
            guard record.outcome == .spoken, let finished = record.finishedAt else { return nil }
            return finished.timeIntervalSince(record.receivedAt)
        }
    }

    // MARK: Drive lifecycle

    func startDrive() {
        guard phase == .stopped else { return }
        policy.reset()
        policy.ownUserID = backend.userID
        policy.isActive = true
        policy.isMuted = false
        muted = false
        phase = .active
        driveStartedAt = Date()
        wasLive = false
        UIDevice.current.isBatteryMonitoringEnabled = true
        batteryAtStart = UIDevice.current.batteryLevel >= 0 ? UIDevice.current.batteryLevel : nil
        location.start()
        Task {
            if !notifications.allowed { _ = await notifications.requestPermission() }
            notificationsAllowed = notifications.allowed
        }
        refreshFeedState()
        startPolling()
        note("Drive started · location \(locationAccess.rawValue) · build \(config.versionDescription)")
        sayLifecycle(location.canRunInBackground ? AlertPhrases.driveStarted : AlertPhrases.driveStartedForegroundOnly)
    }

    func stopDrive() {
        guard phase == .active else { return }
        phase = .stopped
        policy.isActive = false
        policy.reset()
        pollTask?.cancel(); pollTask = nil
        testTask?.cancel(); testTask = nil
        pendingTestAt = nil
        location.stop()
        lastFix = nil  // travel history is never kept
        notifications.clearAll()
        if let start = driveStartedAt {
            let minutes = Date().timeIntervalSince(start) / 60
            let end = UIDevice.current.batteryLevel
            if let begin = batteryAtStart, end >= 0 {
                note(String(format: "Drive stopped after %.1f min · battery %.0f%% → %.0f%%", minutes, begin * 100, end * 100))
            } else {
                note(String(format: "Drive stopped after %.1f min · battery level unavailable", minutes))
            }
        }
        driveStartedAt = nil
        speech.stopAll()
        sayLifecycle(AlertPhrases.driveStopped)
        refreshFeedState()
    }

    func setMuted(_ value: Bool) {
        muted = value
        policy.isMuted = value
        if value { speech.stopAll() }
        note(value ? "Muted" : "Unmuted")
        if phase == .active && UIApplication.shared.applicationState != .active {
            notifications.postSessionNotice(muted: value)
        }
    }

    func appMovedToBackground() {
        guard phase == .active else { return }
        notifications.postSessionNotice(muted: muted)
        note("Pudle in background · background location \(location.canRunInBackground ? "running" : "NOT running")")
    }

    func appBecameActive() {
        locationAccess = location.access
        Task { await notifications.refreshPermission(); notificationsAllowed = notifications.allowed }
    }

    private func locationAccessChanged(_ access: LocationAccess) {
        locationAccess = access
        note("Location permission: \(access.rawValue)")
        if phase == .active && (access == .whenInUse || access == .always) && !location.isUpdating {
            location.start()
        }
        objectWillChange.send()
    }

    // MARK: Labeled test events

    /// Speaks a labeled synthetic event now (no backend involved).
    func injectTest(kind: HazardKind = .debris, located: Bool = false) {
        var hazardLocation: HazardLocation?
        if located, let fix = lastFix {
            let course = fix.courseDegrees ?? 0
            let point = TestEvents.offset(latitude: fix.latitude, longitude: fix.longitude, meters: 400, bearingDegrees: course)
            hazardLocation = HazardLocation(latitude: point.0, longitude: point.1, accuracyMeters: 10,
                                            headingDegrees: fix.courseDegrees)
        }
        handle(TestEvents.make(kind: kind, now: Date(), location: hazardLocation), via: "test")
    }

    /// Schedules a labeled test so the user can switch to Google Maps or lock the phone first.
    /// The timer runs inside Pudle: if iOS has suspended Pudle, it will not fire on time,
    /// which is exactly what this test is meant to reveal.
    func scheduleTest(after seconds: TimeInterval, kind: HazardKind = .debris) {
        guard phase == .active else { lastError = "Start a drive first."; return }
        testTask?.cancel()
        let due = Date().addingTimeInterval(seconds)
        pendingTestAt = due
        note("Test scheduled in \(Int(seconds))s")
        testTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled, let self else { return }
            let lateBy = Date().timeIntervalSince(due)
            self.pendingTestAt = nil
            self.note(String(format: "Test timer fired %.1fs late", max(0, lateBy)))
            self.injectTest(kind: kind)
        }
    }

    // MARK: Event handling

    private func handle(_ event: HazardEvent, via path: String) {
        let receivedAt = Date()
        let decision = policy.decide(event, receiver: lastFix, now: receivedAt)
        let state = Self.appStateDescription()
        switch decision {
        case .speak(let phrase, _):
            let record = DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source, receivedAt: receivedAt,
                                        appState: state, outcome: .spoken, note: "\(path) · route \(speech.currentRoute)")
            deliveries.insert(record, at: 0)
            trimLogs()
            let recordID = record.id
            let createdAt = event.createdAt
            speech.speak(phrase) { [weak self] outcome in
                guard let self else { return }
                switch outcome {
                case .started(let at):
                    self.updateDelivery(recordID) {
                        $0.finishedAt = at
                        $0.note += String(format: " · speech %.2fs after receipt, %.1fs after report", at.timeIntervalSince(receivedAt), at.timeIntervalSince(createdAt))
                    }
                case .finished:
                    break
                case .failed(let why):
                    self.updateDelivery(recordID) { $0.outcome = .failed; $0.note += " · \(why)" }
                    if why.hasPrefix("Audio session") {
                        // Visible fallback with the standard sound. Labeled as a notification, not speech.
                        self.notifications.postAlert(title: "Pudle (not spoken)", body: phrase, withSound: true)
                        self.updateDelivery(recordID) { $0.outcome = .notified }
                    }
                }
            }
            if UIApplication.shared.applicationState != .active {
                notifications.postAlert(title: event.source == .labeledTest ? "Pudle test alert" : "Pudle report",
                                        body: phrase, withSound: false)
            }
        case .suppress(let reason):
            switch reason {
            case .duplicate, .driveNotActive:
                return  // repeated polls of the same row are expected; not worth logging
            default:
                deliveries.insert(DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source,
                                                 receivedAt: receivedAt, appState: state, outcome: .suppressed,
                                                 note: "\(path) · \(Self.describe(reason))"), at: 0)
                trimLogs()
            }
        }
    }

    private func updateDelivery(_ id: UUID, _ change: (inout DeliveryRecord) -> Void) {
        guard let index = deliveries.firstIndex(where: { $0.id == id }) else { return }
        change(&deliveries[index])
    }

    private func sayLifecycle(_ text: String) {
        guard !muted else { return }
        speech.speak(text) { _ in }
    }

    // MARK: Feed polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            var delay: UInt64 = 4
            while !Task.isCancelled {
                guard let self else { return }
                let ok = await self.pollOnce()
                delay = ok ? 4 : min(delay * 2, 30)  // bounded backoff
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            }
        }
    }

    /// Returns true when the feed is healthy (or nothing to poll).
    private func pollOnce() async -> Bool {
        guard phase == .active, backend.isConfigured, backend.session != nil, let convoyID = selectedConvoyID else {
            refreshFeedState()
            return true
        }
        guard online else {
            setFeed(.offline)
            return false
        }
        if case .live = feed {} else { if !wasLive { setFeed(.connecting) } }
        do {
            let result = try await backend.fetchEvents(convoyID: convoyID, now: Date())
            guard phase == .active else { return true }
            setFeed(.live(lastSuccess: Date()))
            if result.rejected > 0 { note("Ignored \(result.rejected) invalid or stale report(s)") }
            for event in result.events { handle(event, via: "feed") }
            return true
        } catch BackendClient.BackendError.signedOut {
            signedInEmail = nil
            setFeed(.signedOut)
            return false
        } catch {
            setFeed(online ? .degraded(error.localizedDescription) : .offline)
            return false
        }
    }

    private func setFeed(_ newState: FeedState) {
        let wasHealthy: Bool
        if case .live = feed { wasHealthy = true } else { wasHealthy = false }
        feed = newState
        switch newState {
        case .live:
            if wasLive && !wasHealthy && phase == .active { note("Feed restored"); sayLifecycle(AlertPhrases.feedRestored) }
            wasLive = true
        case .offline, .degraded:
            if wasHealthy && phase == .active { note("Feed lost"); sayLifecycle(AlertPhrases.feedLost) }
        default:
            break
        }
    }

    private func networkChanged(_ isOnline: Bool) {
        guard online != isOnline else { return }
        online = isOnline
        note(isOnline ? "Network available" : "Network lost")
        if !isOnline && phase == .active && backend.session != nil && selectedConvoyID != nil { setFeed(.offline) }
    }

    private func refreshFeedState() {
        if !backend.isConfigured { feed = .notConfigured }
        else if backend.session == nil { feed = .signedOut }
        else if selectedConvoyID == nil { feed = .notConfigured }
        else if phase == .stopped { feed = .connecting }
    }

    // MARK: Account

    func signIn(email: String, password: String) async {
        do {
            try await backend.signIn(email: email, password: password)
            signedInEmail = backend.session?.email ?? email
            lastError = nil
            await loadConvoys()
        } catch {
            lastError = error.localizedDescription
        }
        refreshFeedState()
    }

    func signOut() async {
        if phase == .active { stopDrive() }
        await backend.signOut()
        signedInEmail = nil
        convoys = []
        selectedConvoyID = nil
        refreshFeedState()
    }

    func loadConvoys() async {
        do {
            convoys = try await backend.listConvoys()
            if let selected = selectedConvoyID, !convoys.contains(where: { $0.id == selected }) { selectedConvoyID = nil }
            if selectedConvoyID == nil { selectedConvoyID = convoys.first?.id }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func joinConvoy(code: String) async {
        do {
            selectedConvoyID = try await backend.joinConvoy(code: code)
            await loadConvoys()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setShareLocation(_ value: Bool) async {
        do {
            if backend.session != nil { try await backend.setLocationConsent(value) }
            shareLocationWithReports = value
        } catch {
            lastError = "Couldn't update location sharing: \(error.localizedDescription)"
        }
    }

    /// Reporting is for passengers or a stopped car. Location is attached only with consent
    /// and only when this phone has a fresh, accurate fix.
    func sendReport(kind: HazardKind) async -> Bool {
        guard let convoyID = selectedConvoyID else { lastError = "Choose a convoy first."; return false }
        var attached: HazardLocation?
        if shareLocationWithReports, let fix = lastFix, Date().timeIntervalSince(fix.timestamp) < 15, fix.accuracyMeters <= 50 {
            let moving = (fix.speedMetersPerSecond ?? 0) >= 3
            attached = HazardLocation(latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters,
                                      headingDegrees: moving ? fix.courseDegrees : nil)
        }
        do {
            try await backend.report(kind: kind, convoyID: convoyID, clientEventID: UUID(), observedAt: Date(), location: attached)
            note("Report sent · \(kind.rawValue) · location \(attached == nil ? "not attached" : "attached")")
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    var isMoving: Bool { (lastFix?.speedMetersPerSecond ?? 0) >= 3 }
    var backendConfigured: Bool { backend.isConfigured }
    var isSignedIn: Bool { backend.session != nil }
    var hazardEventsAvailable: Bool { backend.hazardEventsAvailable }

    // MARK: Diagnostics

    func note(_ text: String) {
        diagnostics.insert(DiagnosticLine(at: Date(), text: text), at: 0)
        trimLogs()
    }

    private func trimLogs() {
        if deliveries.count > 200 { deliveries.removeLast(deliveries.count - 200) }
        if diagnostics.count > 300 { diagnostics.removeLast(diagnostics.count - 300) }
    }

    /// Plain-text evidence for the device test matrix. Contains no coordinates or account data.
    func evidenceReport() -> String {
        let device = UIDevice.current
        var lines = [
            "Pudle diagnostics export \(PudleTime.format(Date()))",
            "Device: \(Self.deviceModel()) · \(device.systemName) \(device.systemVersion)",
            "Build: \(config.versionDescription)",
            "Location access: \(locationAccess.rawValue) · notifications: \(notificationsAllowed ? "allowed" : "off")",
            "Feed: \(DriveStatusText.feedDetail(feed, now: Date()))",
        ]
        let latencies = spokenLatencies
        if let p50 = LatencyStats.percentile(latencies, 50), let p95 = LatencyStats.percentile(latencies, 95) {
            lines.append(String(format: "Receipt-to-speech: n=%d median %.2fs p95 %.2fs", latencies.count, p50, p95))
        }
        lines.append("")
        lines.append("Deliveries (newest first):")
        for record in deliveries {
            lines.append("\(PudleTime.format(record.receivedAt)) \(record.outcome.rawValue) \(record.source.rawValue) \(record.kind.rawValue) [\(record.appState)] \(record.note)")
        }
        lines.append("")
        lines.append("Session notes:")
        for line in diagnostics { lines.append("\(PudleTime.format(line.at)) \(line.text)") }
        return lines.joined(separator: "\n")
    }

    static func appStateDescription() -> String {
        let app = UIApplication.shared
        let state: String
        switch app.applicationState {
        case .active: state = "foreground"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: state = "unknown"
        }
        // Protected data is unavailable while a passcode-locked phone is locked.
        return app.isProtectedDataAvailable ? state : state + ",locked"
    }

    static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
    }

    static func describe(_ reason: SuppressReason) -> String {
        switch reason {
        case .driveNotActive: return "drive not active"
        case .muted: return "muted (not replayed)"
        case .duplicate: return "duplicate"
        case .similarRecentlyAnnounced: return "similar report already announced"
        case .ownReport: return "your own report"
        case .rejected(let why): return "rejected: \(why.rawValue)"
        case .notRelevant(let why): return "not relevant: \(why)"
        case .rateLimited: return "rate limited"
        }
    }
}
