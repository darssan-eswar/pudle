import AVFoundation
import CoreLocation
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

/// The dashcam's current question to the driver.
struct CameraPrompt: Equatable {
    let id = UUID()
    enum Phase: Equatable { case asking, listening, sending, done(String) }
    var kind: HazardKind
    var side: HazardSide
    var blocksRoad: Bool
    var label: String
    var confidence: Double
    /// Position and time when the frame was captured, not when the driver answered.
    var capturedAt: Date
    var location: HazardLocation?
    var phase: Phase
    var transcript: String = ""
}

struct IncomingHazard: Identifiable {
    let id: String
    let title: String
    let message: String
    let blocksRoad: Bool
}

/// Orchestrates one driving session: location, feed polling, alert policy, speech and dashcam.
/// Every delivery path (backend poll, labeled test) goes through `handle(_:)` so the same
/// dedupe/freshness/relevance rules apply to all of them.
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

    // Dashcam
    @Published var dashcamEnabled = false
    @Published private(set) var cameraRunning = false
    @Published private(set) var companionBusy = false
    @Published private(set) var companionMessage = ""
    @Published private(set) var companionVoiceStatus = ""
    private func companionSpoken(_ outcome: SpeechService.Outcome) {
        if case .started(_, let voice) = outcome {
            companionVoiceStatus = voice.hasPrefix("gemini:") ? "Speaking with Gemini voice" : (cloudVoices ? "Using iPhone fallback — Gemini audio unavailable" : "Using iPhone voice")
        }
    }
    private var companionTask: Task<Void, Never>?
    @Published private(set) var cameraPrompt: CameraPrompt?
    @Published private(set) var detectorStatus = "Off"
    @Published private(set) var lastDetection: String = ""
    @Published private(set) var detectorLatencies: [Double] = []

    // Road + reroute
    @Published private(set) var corridor: RoadCorridor?
    @Published private(set) var recordingRoad = false
    @Published private(set) var recordedPoints = 0
    @Published private(set) var activeBlockage: HazardEvent?
    @Published var incomingHazard: IncomingHazard?
    @Published var destination: SavedPlace? { didSet { save(destination, "destination") } }
    @Published var detour: SavedPlace? { didSet { save(detour, "detour") } }

    // Evidence
    @Published private(set) var deliveries: [DeliveryRecord] = []
    @Published private(set) var diagnostics: [DiagnosticLine] = []

    // Account / convoy
    @Published private(set) var signedInEmail: String?
    @Published private(set) var convoys: [BackendClient.Convoy] = []
    @Published var selectedConvoyID: String? {
        didSet { UserDefaults.standard.set(selectedConvoyID, forKey: "convoyID"); corridor = nil; policy.corridor = nil; cancelCameraReport(); refreshFeedState() }
    }
    @Published var units: DistanceUnits {
        didSet { UserDefaults.standard.set(units.rawValue, forKey: "units"); policy.units = units }
    }
    @Published var persona: Persona {
        didSet { UserDefaults.standard.set(persona.rawValue, forKey: "persona"); policy.persona = persona; speech.persona = persona }
    }
    @Published var cloudVoices: Bool {
        didSet { UserDefaults.standard.set(cloudVoices, forKey: "cloudVoices"); speech.useCloudVoice = cloudVoices }
    }
    @Published private(set) var shareLocation: Bool
    @Published private(set) var accountBusy = false
    @Published var lastError: String?

    let config = AppConfig.current
    private let location = LocationService()
    private let speech = SpeechService()
    private let notifications = NotificationService()
    private let camera = CameraService()
    private lazy var backend = BackendClient(config: config)
    private var policy = AlertPolicy()
    private var filter = DetectionFilter()
    private var polling = false
    private var lastPollStarted = Date.distantPast
    private var pollTask: Task<Void, Never>?
    private var testTask: Task<Void, Never>?
    @Published var demoDelivery = UserDefaults.standard.object(forKey: "demoDelivery") as? Bool ?? true {
        didSet { UserDefaults.standard.set(demoDelivery, forKey: "demoDelivery") }
    }
    private var demoDelivered: Set<String> = []
    @Published var fastDemoChecks = false
    @Published private(set) var nextCameraCheck = Date()
    private var checkNowRequested = false
    func checkCameraNow() { checkNowRequested = true }
    private var detectTask: Task<Void, Never>?
    private let pathMonitor = NWPathMonitor()
    private var batteryAtStart: Float?
    private var wasLive = false
    private var loggedPending: Set<String> = []
    private var lastCorridorFetch: Date?

    var cameraSession: AVCaptureSessionProvider { AVCaptureSessionProvider(session: camera.session) }

    init() {
        let defaults = UserDefaults.standard
        units = DistanceUnits(rawValue: defaults.string(forKey: "units") ?? "") ?? (Locale.current.measurementSystem == .metric ? .metric : .imperial)
        persona = Persona(rawValue: defaults.string(forKey: "persona") ?? "") ?? .copilot
        cloudVoices = defaults.object(forKey: "cloudVoices") as? Bool ?? true
        shareLocation = defaults.bool(forKey: "shareLocation")
        selectedConvoyID = defaults.string(forKey: "convoyID")
        destination = Self.load("destination")
        detour = Self.load("detour")
        policy.units = units
        policy.persona = persona
        speech.persona = persona
        speech.useCloudVoice = cloudVoices
        speech.cloudVoice = { [weak self] text, persona in
            guard let self else { throw CancellationError() }
            return try await self.backend.synthesize(text: text, persona: persona, timeout: 12)
        }

        location.onAccessChange = { [weak self] access in self?.locationAccessChanged(access) }
        location.onFix = { [weak self] fix in
            guard let self else { return }
            self.lastFix = fix
            if self.phase == .active, Date().timeIntervalSince(self.lastPollStarted) >= 2, !self.polling {
                Task { [weak self] in _ = await self?.pollOnce() }
            }
            if self.recordingRoad { self.recordedPoints = self.location.recordedRoad.count }
        }
        location.onError = { [weak self] message in self?.note(message) }
        notifications.onMute = { [weak self] in self?.setMuted(true) }
        notifications.onStop = { [weak self] in self?.stopDrive() }
        notifications.onReroute = { [weak self] in self?.reroute() }
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

    var isMoving: Bool { (lastFix?.speedMetersPerSecond ?? 0) >= 3 }
    var backendConfigured: Bool { backend.isConfigured }
    var isSignedIn: Bool { backend.session != nil }

    // MARK: Drive lifecycle

    func startDrive() {
        guard phase == .stopped else { return }
        policy.reset()
        policy.ownUserID = backend.userID
        policy.isActive = true
        policy.isMuted = false
        policy.corridor = corridor
        filter.reset()
        loggedPending.removeAll()
        activeBlockage = nil
        muted = false
        phase = .active
        driveStartedAt = Date()
        wasLive = false
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        batteryAtStart = UIDevice.current.batteryLevel >= 0 ? UIDevice.current.batteryLevel : nil
        location.start()
        Task {
            if !notifications.allowed { _ = await notifications.requestPermission() }
            notificationsAllowed = notifications.allowed
        }
        refreshFeedState()
        startPolling()
        if dashcamEnabled { startDashcam() }
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
        stopDashcam()
        if recordingRoad { _ = location.stopRecordingRoad(); recordingRoad = false }
        location.stop()
        incomingHazard = nil
        lastFix = nil  // travel history is never kept
        activeBlockage = nil
        notifications.clearAll()
        UIApplication.shared.isIdleTimerDisabled = false
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
        if cameraRunning {
            note("Pudle left the screen: iOS pauses the dashcam until Pudle is back in front")
            detectorStatus = "Paused — keep Pudle on screen for the dashcam"
        }
        note("Pudle in background · background location \(location.canRunInBackground ? "running" : "NOT running")")
    }

    func appBecameActive() {
        locationAccess = location.access
        Task { await notifications.refreshPermission(); notificationsAllowed = notifications.allowed }
        if phase == .active && cameraRunning { detectorStatus = "Watching the road" }
    }

    private func locationAccessChanged(_ access: LocationAccess) {
        locationAccess = access
        note("Location permission: \(access.rawValue)")
        if phase == .active && (access == .whenInUse || access == .always) && !location.isUpdating {
            location.start()
        }
        objectWillChange.send()
    }

    // MARK: Dashcam

    func setDashcam(_ enabled: Bool) {
        dashcamEnabled = enabled
        if phase == .active { enabled ? startDashcam() : stopDashcam() }
    }

    private func startDashcam() {
        guard backend.isConfigured, backend.session != nil else {
            detectorStatus = "Sign in to use the dashcam"
            return
        }
        Task {
            guard await CameraService.requestAccess() else {
                detectorStatus = "Camera access is off — enable it in Settings"
                return
            }
            _ = await SpeechService.requestListeningPermission()
            camera.start()
            cameraRunning = true
            detectorStatus = "Watching the road"
            note("Dashcam on (frames go to Gemini, no local image recording)")
            detectTask?.cancel()
            detectTask = Task { [weak self] in await self?.detectionLoop() }
        }
    }

    private func stopDashcam() {
        companionTask?.cancel()
        speech.cancelListening()
        companionBusy = false
        detectTask?.cancel(); detectTask = nil
        camera.stop()
        cameraRunning = false
        cameraPrompt = nil
        detectorStatus = "Off"
    }

    func describeScene() {
        guard phase == .active, cameraRunning, !companionBusy, cameraPrompt == nil,
              let (jpeg, capturedAt) = camera.snapshotJPEG(orientation: UIDevice.current.orientation) else {
            companionMessage = "Start a drive and enable Dashcam first; finish any pending report."
            return
        }
        let fix = lastFix
        companionBusy = true
        companionMessage = "Looking at a fresh frame…"
        companionTask = Task { [weak self] in
            guard let self else { return }
            defer { self.companionBusy = false }
            do {
                let result = try await self.backend.detectHazard(jpeg: jpeg, describe: true)
                guard !Task.isCancelled, self.phase == .active, self.cameraRunning, UIApplication.shared.applicationState == .active else { return }
                let description = result.description ?? "I couldn't describe this frame."
                self.companionMessage = description
                if result.hazard, let kind = HazardKind(rawValue: result.kind), result.confidence >= 0.55 {
                    self.askDriver(about: .init(kind: kind, side: HazardSide(rawValue: result.side) ?? .unknown,
                                              blocksRoad: result.blocks_road, confidence: result.confidence, at: capturedAt),
                                   label: result.label, capturedAt: capturedAt, fix: fix, description: description)
                } else if !self.muted {
                    self.speech.speak(description) { [weak self] outcome in self?.companionSpoken(outcome) }
                }
            } catch {
                guard !Task.isCancelled, self.phase == .active else { return }
                self.companionMessage = "Scene check unavailable: \(error.localizedDescription)"
            }
        }
    }

    func listenToCompanion() {
        guard phase == .active, cameraRunning, !companionBusy else { return }
        Task {
            guard await SpeechService.requestListeningPermission(), phase == .active else { return }
            companionBusy = true
            let promptID = cameraPrompt?.id
            companionMessage = "Listening: say What do you see, Report it, or Cancel."
            speech.listen(seconds: 7) { [weak self] intent, transcript in
                guard let self, self.phase == .active, self.cameraRunning else { return }
                self.companionBusy = false
                switch CompanionCommand.parse(transcript) {
                case .cancel: self.cancelCameraReport(spoken: true)
                case .describe: self.describeScene()
                case .report:
                    if self.cameraPrompt != nil, self.cameraPrompt?.id == promptID { self.confirmCameraReport() }
                    else { self.companionMessage = "There is no pending detected hazard to report." }
                case .unknown: self.companionMessage = "No command matched. Say What do you see, Report it, or Cancel."
                }
            }
        }
    }

    private func detectionLoop() async {
        var consecutiveErrors = 0
        while !Task.isCancelled, phase == .active, cameraRunning {
            let cycleStart = Date()
            if UIApplication.shared.applicationState == .active, cameraPrompt == nil, !companionBusy, online,
               let snapshot = camera.snapshotJPEG(orientation: UIDevice.current.orientation) {
                let (jpeg, capturedAt) = snapshot
                let fixAtCapture = lastFix
                do {
                    let started = Date()
                    let result = try await backend.detectHazard(jpeg: jpeg)
                    guard !Task.isCancelled, phase == .active, cameraRunning, UIApplication.shared.applicationState == .active else { return }
                    let latency = Date().timeIntervalSince(started)
                    detectorLatencies.append(latency)
                    if detectorLatencies.count > 200 { detectorLatencies.removeFirst() }
                    consecutiveErrors = 0
                    detectorStatus = "Watching the road"
                    let kind = HazardKind(rawValue: result.kind)
                    lastDetection = result.hazard
                        ? String(format: "%@ · %@ · %.0f%%%@", result.label.isEmpty ? result.kind : result.label, result.side,
                                 result.confidence * 100, result.blocks_road ? " · may block road" : "")
                        : "No hazard flagged in this frame"
                    let observation = (result.hazard && kind != nil)
                        ? DetectionFilter.Observation(kind: kind!, side: HazardSide(rawValue: result.side) ?? .unknown,
                                                      blocksRoad: result.blocks_road, confidence: result.confidence, at: capturedAt)
                        : nil
                    filter.window = fastDemoChecks ? 12 : 5
                    if let accepted = filter.add(observation, now: Date()) {
                        askDriver(about: accepted, label: result.label, capturedAt: capturedAt, fix: fixAtCapture)
                    }
                } catch {
                    guard !Task.isCancelled, phase == .active, cameraRunning else { return }
                    consecutiveErrors += 1
                    detectorStatus = "Hazard checker unavailable: \(error.localizedDescription)"
                    if consecutiveErrors == 1 { note("Hazard checker error: \(error.localizedDescription)") }
                }
            }
            // Conservative free-tier cadence; account quotas still apply. One request in flight.
            let quotaLimited = detectorStatus.contains("429") || detectorStatus.localizedCaseInsensitiveContains("too many")
            let target: TimeInterval = consecutiveErrors > 0 ? (quotaLimited ? 60 : min(12, Double(consecutiveErrors) * 3)) : (fastDemoChecks ? 3 : 15)
            nextCameraCheck = cycleStart.addingTimeInterval(target)
            while !Task.isCancelled, Date() < nextCameraCheck {
                if checkNowRequested, !quotaLimited { checkNowRequested = false; break }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
        }
    }

    private func askDriver(about observation: DetectionFilter.Observation, label: String, capturedAt: Date, fix: ReceiverFix?, description: String? = nil) {
        var hazardLocation: HazardLocation?
        let matchedFix = location.fix(near: capturedAt) ?? fix
        if let fix = matchedFix, abs(capturedAt.timeIntervalSince(fix.timestamp)) <= 3, fix.accuracyMeters >= 0, fix.accuracyMeters <= 40 {
            // Approximate observation position: monocular classification cannot measure object depth.
            let lat = fix.latitude, lon = fix.longitude
            hazardLocation = HazardLocation(latitude: lat, longitude: lon, accuracyMeters: max(fix.accuracyMeters, 10),
                                            headingDegrees: fix.courseDegrees)
        }
        cameraPrompt = CameraPrompt(kind: observation.kind, side: observation.side, blocksRoad: observation.blocksRoad,
                                    label: label, confidence: observation.confidence, capturedAt: capturedAt,
                                    location: hazardLocation, phase: .asking)
        note(String(format: "Camera flagged possible %@ (%@, %.0f%%)%@", observation.kind.rawValue, observation.side.rawValue,
                    observation.confidence * 100, hazardLocation == nil ? " · no GPS fix" : ""))
        let text = (description.map { $0 + " " } ?? "") + AlertPhrases.cameraPrompt(kind: observation.kind, side: observation.side,
                                             blocksRoad: observation.blocksRoad, persona: persona)
        let promptID = cameraPrompt?.id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 45_000_000_000)
            guard !Task.isCancelled, let self, self.cameraPrompt?.id == promptID, self.cameraPrompt?.phase != .sending else { return }
            self.cancelCameraReport()
        }
        guard !muted else { cameraPrompt?.phase = .done("Muted — tap Report or Cancel"); return }
        speech.speak(text) { [weak self] outcome in
            guard let self, self.phase == .active, self.cameraPrompt?.id == promptID else { return }
            self.companionSpoken(outcome)
            switch outcome {
            case .finished: self.listenForAnswer()
            case .failed: self.cameraPrompt?.phase = .done("Voice interrupted — tap Report or Cancel")
            case .started: break
            }
        }
    }

    private func listenForAnswer() {
        guard cameraPrompt?.phase == .asking || cameraPrompt?.phase == .listening else { return }
        cameraPrompt?.phase = .listening
        let promptID = cameraPrompt?.id
        speech.listen(seconds: 7) { [weak self] intent, transcript in
            guard let self, self.phase == .active, self.cameraPrompt?.id == promptID else { return }
            self.cameraPrompt?.transcript = transcript
            switch intent {
            case .confirm: self.confirmCameraReport()
            case .cancel: self.cancelCameraReport(spoken: true)
            case .unknown:
                // Still on screen: a passenger can tap Report / Cancel. Auto-dismiss after 15 s.
                self.cameraPrompt?.phase = .done("No answer heard — tap Report or Cancel")
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    if self?.cameraPrompt?.id == promptID, case .done = self?.cameraPrompt?.phase { self?.cameraPrompt = nil }
                }
            }
        }
    }

    func confirmCameraReport() {
        guard let prompt = cameraPrompt, let convoyID = selectedConvoyID else {
            lastError = "Join a convoy to share reports."
            cameraPrompt = nil
            return
        }
        guard phase == .active, prompt.phase != .sending else { return }
        guard Date().timeIntervalSince(prompt.capturedAt) <= 60 else { cameraPrompt?.phase = .done("Observation expired — check again"); return }
        speech.cancelListening()
        let hazardLocation = prompt.location
        guard demoDelivery || hazardLocation != nil else {
            cameraPrompt?.phase = .done("No accurate GPS at capture — move outdoors and check again")
            speech.speak("Location is allowed, but I didn't get an accurate GPS position when I saw this. Move outdoors and check again.") { _ in }
            return
        }
        cameraPrompt?.phase = .sending
        Task {
            do {
                // Explicit confirmation shares the observed hazard position with the convoy.
                try await backend.setLocationConsent(true)
                guard phase == .active, cameraPrompt?.id == prompt.id else { return }
                shareLocation = true
                UserDefaults.standard.set(true, forKey: "shareLocation")
                try await backend.report(kind: prompt.kind, convoyID: convoyID, clientEventID: prompt.id,
                                         observedAt: prompt.capturedAt, location: hazardLocation,
                                         source: hazardLocation == nil ? .convoyMember : .driverConfirmedCamera, side: prompt.side, blocksRoad: prompt.blocksRoad)
                guard phase == .active, cameraPrompt?.id == prompt.id else { return }
                note("Camera report sent · \(prompt.kind.rawValue) · \(prompt.side.rawValue)\(prompt.blocksRoad ? " · possible blockage" : "")")
                cameraPrompt?.phase = .done("Sent to your convoy")
                speech.speak(AlertPhrases.reportSent(blocksRoad: prompt.blocksRoad)) { _ in }
            } catch {
                guard phase == .active, cameraPrompt?.id == prompt.id else { return }
                note("Camera report failed: \(error.localizedDescription)")
                cameraPrompt?.phase = .done("Not sent: \(error.localizedDescription)")
                speech.speak(AlertPhrases.reportFailed) { _ in }
            }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if cameraPrompt?.id == prompt.id { cameraPrompt = nil }
        }
    }

    func cancelCameraReport(spoken: Bool = false) {
        guard cameraPrompt != nil else { return }
        speech.cancelListening()
        note("Camera report cancelled")
        cameraPrompt = nil
        if spoken { speech.speak(AlertPhrases.reportCancelled) { _ in } }
    }

    // MARK: Labeled test events

    /// Speaks a labeled synthetic event now (no backend involved).
    func injectTest(kind: HazardKind = .debris, located: Bool = false, blocksRoad: Bool = false) {
        var hazardLocation: HazardLocation?
        if located, let fix = lastFix {
            let course = fix.courseDegrees ?? 0
            let point = TestEvents.offset(latitude: fix.latitude, longitude: fix.longitude, meters: 800, bearingDegrees: course)
            hazardLocation = HazardLocation(latitude: point.0, longitude: point.1, accuracyMeters: 10,
                                            headingDegrees: fix.courseDegrees)
        }
        var event = TestEvents.make(kind: kind, now: Date(), location: hazardLocation)
        event.blocksRoad = blocksRoad
        event.side = .right
        handle(event, via: "test")
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
        if demoDelivery, path == "feed" {
            guard phase == .active, event.reporterID != backend.userID,
                  event.expiresAt > receivedAt,
                  event.createdAt >= (driveStartedAt ?? receivedAt).addingTimeInterval(-2),
                  !demoDelivered.contains(event.id) else { return }
            demoDelivered.insert(event.id)
            let label = AlertPhrases.label(event.kind).lowercased()
            let side = event.side == .unknown ? "" : " on the \(event.side.rawValue)"
            let message = "A convoy member reported \(label)\(side)\(event.blocksRoad ? "; possible road blockage" : "")."
            incomingHazard = IncomingHazard(id: event.id, title: "Demo · reported \(label)", message: message, blocksRoad: false)
            if !muted { speech.speak(message) { _ in } }
            if UIApplication.shared.applicationState != .active {
                notifications.postAlert(title: "Pudle demo · \(label)", body: message, withSound: muted, blockage: false)
            }
            deliveries.insert(DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source,
                receivedAt: receivedAt, appState: Self.appStateDescription(), outcome: .notified,
                note: "Demo popup delivered · GPS/direction bypassed"), at: 0)
            trimLogs()
            return
        }
        let decision = policy.decide(event, receiver: lastFix, now: receivedAt)
        let state = Self.appStateDescription()
        switch decision {
        case .speak(let phrase, let relevance):
            let title: String
            if event.source == .labeledTest {
                title = "Pudle test alert"
            } else if case .ahead = relevance {
                title = event.blocksRoad ? "Possible road blockage ahead" : "Reported \(AlertPhrases.label(event.kind).lowercased()) ahead"
            } else {
                title = "Convoy hazard report"
            }
            incomingHazard = IncomingHazard(id: event.id, title: title, message: phrase, blocksRoad: event.blocksRoad)
            let record = DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source, receivedAt: receivedAt,
                                        appState: state, outcome: .spoken,
                                        note: "\(path) · \(Self.describe(relevance)) · route \(speech.currentRoute)")
            deliveries.insert(record, at: 0)
            trimLogs()
            let recordID = record.id
            let createdAt = event.createdAt
            if event.blocksRoad, case .ahead = relevance { activeBlockage = event }
            speech.speak(phrase) { [weak self] outcome in
                guard let self else { return }
                switch outcome {
                case .started(let at, let voice):
                    self.updateDelivery(recordID) {
                        $0.finishedAt = at
                        $0.note += String(format: " · %@ · speech %.2fs after receipt, %.1fs after report", voice,
                                          at.timeIntervalSince(receivedAt), at.timeIntervalSince(createdAt))
                    }
                case .finished:
                    break
                case .failed(let why):
                    self.updateDelivery(recordID) { $0.outcome = .failed; $0.note += " · \(why)" }
                    if why.hasPrefix("Audio session") {
                        self.notifications.postAlert(title: "Pudle (not spoken)", body: phrase, withSound: true,
                                                     blockage: event.blocksRoad)
                        self.updateDelivery(recordID) { $0.outcome = .notified }
                    }
                }
            }
            if UIApplication.shared.applicationState != .active || event.blocksRoad {
                notifications.postAlert(title: event.blocksRoad ? "Possible road blockage reported" :
                                            (event.source == .labeledTest ? "Pudle test alert" : "Pudle report"),
                                        body: event.blocksRoad ? phrase + " Tap to reroute in Google Maps." : phrase,
                                        withSound: false, blockage: event.blocksRoad)
            }
        case .suppress(let reason):
            switch reason {
            case .duplicate, .driveNotActive:
                return
            case .notRelevantYet, .rateLimited:
                // Re-checked every poll; log only the first time per event to keep the log readable.
                guard !loggedPending.contains(event.id) else { return }
                loggedPending.insert(event.id)
                deliveries.insert(DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source,
                                                 receivedAt: receivedAt, appState: state, outcome: .suppressed,
                                                 note: "\(path) · \(Self.describe(reason))"), at: 0)
            default:
                deliveries.insert(DeliveryRecord(eventID: event.id, kind: event.kind, source: event.source,
                                                 receivedAt: receivedAt, appState: state, outcome: .suppressed,
                                                 note: "\(path) · \(Self.describe(reason))"), at: 0)
            }
            trimLogs()
        }
    }

    private func updateDelivery(_ id: UUID, _ change: (inout DeliveryRecord) -> Void) {
        guard let index = deliveries.firstIndex(where: { $0.id == id }) else { return }
        change(&deliveries[index])
    }

    private func sayLifecycle(_ text: String) {
        guard !muted else { return }
        speech.speak(text, cloud: false) { _ in }
    }

    // MARK: Reroute

    /// Opens Google Maps with the reviewed detour. Called from the in-app button or the notification.
    func reroute() {
        guard let detour else { lastError = "Choose and review a detour waypoint first."; return }
        guard let destination else {
            lastError = "Set a destination (and detour) in Settings → Demo route first."
            return
        }
        if !DetourService.open(destination: destination, via: detour) {
            lastError = "Couldn't open Google Maps."
        } else {
            note("Opened Google Maps \(detour == nil ? "to destination" : "via reviewed detour")")
        }
    }

    func navigate() {
        guard let destination else { lastError = "Set a destination in Settings → Demo route first."; return }
        _ = DetourService.open(destination: destination, via: nil)
    }

    func searchPlaces(_ query: String) async -> [SavedPlace] {
        let near = lastFix.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        return await DetourService.search(query, near: near)
    }

    func useCurrentPositionAsDetour() {
        guard let fix = lastFix else { lastError = "No GPS fix yet — start a drive outdoors first."; return }
        detour = SavedPlace(name: "Detour point (here)", latitude: fix.latitude, longitude: fix.longitude)
    }

    // MARK: Demo road

    func startRecordingRoad() {
        guard phase == .active else { lastError = "Start a drive first, then record while driving the demo road."; return }
        location.startRecordingRoad()
        recordingRoad = true
        recordedPoints = 0
        note("Recording demo road")
    }

    func finishRecordingRoad(name: String) async {
        let points = location.stopRecordingRoad()
        recordingRoad = false
        guard let convoyID = selectedConvoyID else { lastError = "Choose a convoy first."; return }
        guard let corridor = RoadCorridor(id: "local", name: name, points: points) else {
            lastError = "Too short — drive at least a few hundred feet while recording."
            return
        }
        guard shareLocation else { lastError = "Turn on location sharing to save the road for your convoy."; return }
        do {
            try await backend.saveCorridor(convoyID: convoyID, name: name, points: points)
            self.corridor = corridor
            policy.corridor = corridor
            note(String(format: "Saved demo road '%@' (%.1f km, %d points)", name, corridor.lengthMeters / 1000, points.count))
        } catch {
            lastError = "Couldn't save the road: \(error.localizedDescription)"
        }
    }

    private func refreshCorridor(convoyID: String) async {
        if let last = lastCorridorFetch, Date().timeIntervalSince(last) < 60, corridor != nil { return }
        lastCorridorFetch = Date()
        if let fetched = try? await backend.fetchCorridor(convoyID: convoyID), selectedConvoyID == convoyID, phase == .active, fetched != corridor {
            corridor = fetched
            policy.corridor = fetched
            note(String(format: "Using demo road '%@' (%.1f km)", fetched.name, fetched.lengthMeters / 1000))
        }
    }

    // MARK: Feed polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            var delay: Double = 2
            while !Task.isCancelled {
                guard let self else { return }
                let ok = await self.pollOnce()
                delay = ok ? 2 : min(delay * 2, 30)  // bounded backoff
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    /// Returns true when the feed is healthy (or nothing to poll).
    private func pollOnce() async -> Bool {
        guard !polling else { return true }
        polling = true
        lastPollStarted = Date()
        defer { polling = false }
        guard phase == .active, backend.isConfigured, backend.session != nil, let convoyID = selectedConvoyID else {
            refreshFeedState()
            return true
        }
        guard online else {
            setFeed(.offline)
            return false
        }
        if case .live = feed {} else if !wasLive { setFeed(.connecting) }
        do {
            await refreshCorridor(convoyID: convoyID)
            let result = try await backend.fetchEvents(convoyID: convoyID, now: Date())
            guard phase == .active, selectedConvoyID == convoyID, backend.session != nil, !Task.isCancelled else { return true }
            setFeed(.live(lastSuccess: Date()))
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
        guard !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        do {
            try await backend.signIn(email: email, password: password)
            await afterSignIn(fallbackEmail: email)
        } catch {
            lastError = error.localizedDescription
        }
        refreshFeedState()
    }

    func signUp(email: String, password: String) async {
        guard !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        do {
            try await backend.signUp(email: email, password: password)
            await afterSignIn(fallbackEmail: email)
        } catch {
            lastError = error.localizedDescription
        }
        refreshFeedState()
    }

    private func afterSignIn(fallbackEmail: String) async {
        signedInEmail = backend.session?.email ?? fallbackEmail
        lastError = nil
        policy.ownUserID = backend.userID
        await loadConvoys()
        if shareLocation { try? await backend.setLocationConsent(true) }
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

    func createConvoy(name: String) async {
        do {
            selectedConvoyID = try await backend.createConvoy(name: name)
            await loadConvoys()
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

    var selectedConvoy: BackendClient.Convoy? { convoys.first { $0.id == selectedConvoyID } }

    func setShareLocation(_ value: Bool) async {
        do {
            if backend.session != nil { try await backend.setLocationConsent(value) }
            shareLocation = value
            UserDefaults.standard.set(value, forKey: "shareLocation")
            if !value { corridor = nil; policy.corridor = nil }
        } catch {
            lastError = "Couldn't update location sharing: \(error.localizedDescription)"
        }
    }

    /// Hand-tapped report, for a passenger or a stopped car. Location only with consent and a fresh fix.
    func sendReport(kind: HazardKind, side: HazardSide = .unknown, blocksRoad: Bool = false) async -> Bool {
        guard let convoyID = selectedConvoyID else { lastError = "Choose a convoy first."; return false }
        var attached: HazardLocation?
        if shareLocation, let fix = lastFix, Date().timeIntervalSince(fix.timestamp) < 15, fix.accuracyMeters <= 40 {
            attached = HazardLocation(latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: max(fix.accuracyMeters, 5),
                                      headingDegrees: fix.courseDegrees)
        }
        do {
            try await backend.report(kind: kind, convoyID: convoyID, clientEventID: UUID(), observedAt: Date(),
                                     location: attached, source: .convoyMember, side: side, blocksRoad: blocksRoad)
            note("Report sent · \(kind.rawValue) · location \(attached == nil ? "not attached" : "attached")")
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

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
            "Voice: \(persona.rawValue) · cloud voices \(cloudVoices ? "on" : "off")",
            "Demo road: \(corridor.map { String(format: "%@ %.1f km", $0.name, $0.lengthMeters / 1000) } ?? "none")",
        ]
        let latencies = spokenLatencies
        if let p50 = LatencyStats.percentile(latencies, 50), let p95 = LatencyStats.percentile(latencies, 95) {
            lines.append(String(format: "Receipt-to-speech: n=%d median %.2fs p95 %.2fs", latencies.count, p50, p95))
        }
        if let p50 = LatencyStats.percentile(detectorLatencies, 50), let p95 = LatencyStats.percentile(detectorLatencies, 95) {
            lines.append(String(format: "Frame-to-detection (Gemini round trip): n=%d median %.2fs p95 %.2fs",
                                detectorLatencies.count, p50, p95))
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
        return app.isProtectedDataAvailable ? state : state + ",locked"
    }

    static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
    }

    static func describe(_ relevance: Relevance) -> String {
        switch relevance {
        case .unlocated: return "unlocated"
        case .receiverUnknown(let why): return "receiver unknown (\(why))"
        case .nearbyDirectionUnverified(let d): return String(format: "nearby %.0fm, direction unverified", d)
        case .ahead(let d, let road): return String(format: "ahead %.0fm%@", d, road ? " on demo road" : " by heading")
        case .notRelevant(let why): return "not relevant (\(why))"
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
        case .notRelevantYet(let why): return "waiting: \(why)"
        case .rateLimited: return "rate limited"
        }
    }

    // MARK: Persistence helpers

    private func save(_ place: SavedPlace?, _ key: String) {
        UserDefaults.standard.set(place.flatMap { try? JSONEncoder().encode($0) }, forKey: key)
    }

    private static func load(_ key: String) -> SavedPlace? {
        UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(SavedPlace.self, from: $0) }
    }
}

/// Wraps the capture session for the SwiftUI preview layer.
struct AVCaptureSessionProvider {
    let session: AVCaptureSession
}
