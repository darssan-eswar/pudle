import AVFoundation
import SwiftUI
import PudleCore

struct DriveView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showReport = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    HStack(spacing: 12) {
                        Image(systemName: "waveform")
                            .font(.title2.bold())
                            .foregroundStyle(PudleTheme.purple)
                            .frame(width: 52, height: 52)
                            .background(PudleTheme.lilac, in: RoundedRectangle(cornerRadius: 18))
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Your road companion").font(.title2.bold())
                            Text("A little heads-up for the road ahead.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    StatusCard(line: DriveStatusText.headline(model.snapshot))
                    if let blockage = model.activeBlockage { BlockageCard(event: blockage) }
                    primaryControls
                    GroupBox {
                        Toggle("Demo mode", isOn: $model.demoDelivery)
                    } label: {
                        Label("Convoy alerts", systemImage: "iphone.gen3.radiowaves.left.and.right")
                    }
                    DashcamCard()
                    if model.phase == .active { CapabilityList() }
                    DisclosureGroup("Developer tests (synthetic)") { testControls }
                        .font(.footnote)
                        .padding(16)
                        .background(PudleTheme.paper, in: RoundedRectangle(cornerRadius: 20))
                    if model.phase == .active || model.isSignedIn {
                        Button {
                            showReport = true
                        } label: {
                            Label("Report a hazard (passenger)", systemImage: "exclamationmark.bubble")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(!model.isSignedIn || model.selectedConvoyID == nil)
                    }
                    if model.destination != nil {
                        Button { model.navigate() } label: {
                            Label("Navigate in Google Maps", systemImage: "arrow.triangle.turn.up.right.diamond")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                    NavigationLink {
                        DiagnosticsView()
                    } label: {
                        Label("Delivery log & evidence", systemImage: "list.bullet.rectangle")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    NavigationLink {
                        LimitationsView()
                    } label: {
                        Label("What Pudle can and can't do", systemImage: "info.circle")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
            .background(PudleTheme.ivory)
            .navigationTitle("pudle")
            .toolbarBackground(PudleTheme.ivory, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .sheet(item: $model.incomingHazard) { report in
                ReceivedHazardView(report: report)
            }
            .sheet(isPresented: $showReport) { ReportView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .alert("Pudle", isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.lastError ?? "")
            }
        }
    }

    private var primaryControls: some View {
        VStack(spacing: 12) {
            if model.phase == .stopped {
                Button {
                    model.startDrive()
                } label: {
                    Label("Start drive", systemImage: "car.fill")
                        .font(.title2.bold())
                        .frame(maxWidth: .infinity, minHeight: 64)
                }
                .buttonStyle(.borderedProminent)
                .tint(PudleTheme.purple)
            } else {
                HStack(spacing: 12) {
                    Button {
                        model.setMuted(!model.muted)
                    } label: {
                        Label(model.muted ? "Unmute" : "Mute", systemImage: model.muted ? "speaker.wave.2.fill" : "speaker.slash.fill")
                            .font(.title3.bold())
                            .frame(maxWidth: .infinity, minHeight: 64)
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        model.stopDrive()
                    } label: {
                        Label("Stop drive", systemImage: "stop.fill")
                            .font(.title3.bold())
                            .frame(maxWidth: .infinity, minHeight: 64)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PudleTheme.danger)
                }
            }
        }
    }

    private var testControls: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Text("Labeled test alerts are synthetic. They are spoken as “test alert … not a real report”.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Speak test now") { model.injectTest() }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Test in 15 s") { model.scheduleTest(after: 15) }
                        .buttonStyle(.bordered)
                    Button("in 60 s") { model.scheduleTest(after: 60) }
                        .buttonStyle(.bordered)
                }
                .disabled(model.phase != .active)
                if let due = model.pendingTestAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text("Test alert in \(max(0, Int(due.timeIntervalSince(context.date))))s — switch to Google Maps or lock the phone now.")
                            .font(.callout.bold())
                    }
                } else if model.phase != .active {
                    Text("Start a drive to enable tests.").font(.footnote).foregroundStyle(.secondary)
                }
            }
        } label: {
            Label("Lifecycle test", systemImage: "waveform")
        }
    }
}

struct DashcamCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Spot hazards with the camera", isOn: Binding(get: { model.dashcamEnabled }, set: { model.setDashcam($0) }))
                    .disabled(!model.isSignedIn)
                if model.cameraRunning {
                    CameraPreview(session: model.cameraSession.session)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(alignment: .bottomLeading) {
                            Text(model.lastDetection.isEmpty ? "Starting…" : model.lastDetection)
                                .font(.caption.bold())
                                .padding(6)
                                .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
                                .foregroundStyle(.white)
                                .padding(8)
                        }
                }
                Toggle("Natural Gemini voice", isOn: $model.cloudVoices)
                HStack {
                    Button("What do you see?") { model.describeScene() }.buttonStyle(.bordered)
                    Button("Talk to Pudle") { model.listenToCompanion() }.buttonStyle(.bordered)
                }.disabled(!model.cameraRunning || model.companionBusy)
                if !model.companionMessage.isEmpty { Text(model.companionMessage).font(.footnote) }
                if !model.companionVoiceStatus.isEmpty { Text(model.companionVoiceStatus).font(.caption).foregroundStyle(.secondary) }
                DisclosureGroup("Camera check speed") {
                    Toggle("Faster demo checks (every 3 seconds)", isOn: $model.fastDemoChecks)
                        .disabled(!model.cameraRunning)
                    Text("Faster checks may exceed your free Gemini quota.")
                        .font(.caption).foregroundStyle(.secondary)
                }.font(.footnote)
                Button("Check now") { model.checkCameraNow() }
                    .disabled(!model.cameraRunning || model.cameraPrompt != nil)
                if model.cameraRunning {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text("Next check in \(max(0, Int(model.nextCameraCheck.timeIntervalSince(context.date).rounded(.up))))s").font(.caption)
                    }
                }
                if let prompt = model.cameraPrompt { PromptCard(prompt: prompt) }
                Text(model.dashcamEnabled ? model.detectorStatus
                     : "Mount the phone facing the road. Every 15 seconds a camera frame is sent to Gemini for analysis. Only confirmed reports go to your convoy. Keep Pudle on screen; camera capture requires foreground.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } label: {
            Label("Eyes on the road", systemImage: "camera.viewfinder")
        }
    }
}

struct PromptCard: View {
    @EnvironmentObject private var model: AppModel
    let prompt: CameraPrompt

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(prompt.blocksRoad ? "Possible road blockage" : "Possible \(AlertPhrases.label(prompt.kind).lowercased())")
                .font(.headline)
            Text("\(prompt.side == .unknown ? "" : "Side: \(prompt.side.rawValue) · ")Model confidence \(Int(prompt.confidence * 100))% (not a measured accuracy)")
                .font(.caption)
            switch prompt.phase {
            case .asking: Text("Asking you…").font(.callout)
            case .listening: Label("Listening — say “report it” or “cancel”", systemImage: "mic.fill").font(.callout.bold())
            case .sending: ProgressView("Sending…")
            case .done(let message): Text(message).font(.callout.bold())
            }
            if !prompt.transcript.isEmpty { Text("Heard: “\(prompt.transcript)”").font(.caption).foregroundStyle(.secondary) }
            Text("Saying or tapping Report it shares this hazard’s GPS position with your convoy. Routine GPS stays on your phone.")
                .font(.caption).foregroundStyle(.secondary)
            if prompt.phase != .sending {
                HStack {
                    Button("Report it") { model.confirmCameraReport() }.buttonStyle(.borderedProminent)
                    Button("Cancel", role: .cancel) { model.cancelCameraReport() }.buttonStyle(.bordered)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PudleTheme.peach, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct BlockageCard: View {
    @EnvironmentObject private var model: AppModel
    let event: HazardEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Possible road blockage ahead", systemImage: "exclamationmark.octagon.fill")
                .font(.headline)
            Text("Reported \(event.createdAt.formatted(date: .omitted, time: .shortened)) by \(event.source == .driverConfirmedCamera ? "a Pudle driver (camera, confirmed)" : "a convoy member").")
                .font(.caption)
            Button {
                model.reroute()
            } label: {
                Label(model.detour == nil ? "Set a reviewed detour in Settings" : "Reroute via detour in Google Maps", systemImage: "arrow.triangle.branch")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PudleTheme.peach, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        if let connection = view.previewLayer.connection, connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

struct StatusCard: View {
    let line: StatusLine

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(line.title, systemImage: icon).font(.title3.bold())
            Text(line.detail).font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(fill, in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(color.opacity(0.3)))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch line.tone {
        case .good: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .problem: return "exclamationmark.triangle.fill"
        case .neutral: return "car.side.fill"
        }
    }

    private var fill: Color {
        switch line.tone {
        case .good: return PudleTheme.mint
        case .warning, .problem: return PudleTheme.peach
        case .neutral: return PudleTheme.lilac.opacity(0.55)
        }
    }

    private var color: Color {
        switch line.tone {
        case .good: return PudleTheme.green
        case .warning: return .orange
        case .problem: return .red
        case .neutral: return PudleTheme.purple
        }
    }
}

struct CapabilityList: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                row("Location", value: locationText, ok: model.snapshot.backgroundLocationRunning)
                row("Report feed", value: DriveStatusText.feedDetail(model.feed, now: Date()), ok: isLive)
                row("Demo road", value: model.corridor.map { String(format: "%@ · %.1f km", $0.name, $0.lengthMeters / 1000) }
                    ?? "None — using heading only", ok: model.corridor != nil)
                row("Network", value: model.online ? "Connected" : "Offline", ok: model.online)
                row("Notifications", value: model.notificationsAllowed ? "Allowed (Mute/Stop/Reroute)" : "Off — no lock-screen controls", ok: model.notificationsAllowed)
                if model.recordingRoad {
                    row("Recording road", value: "\(model.recordedPoints) points", ok: true)
                }
                if let audio = model.audioNote { row("Audio", value: audio, ok: false) }
            }
            .font(.callout)
        }
    }

    private var isLive: Bool { if case .live = model.feed { return true } else { return false } }

    private var locationText: String {
        switch model.locationAccess {
        case .whenInUse, .always:
            guard model.snapshot.backgroundLocationRunning else { return "Allowed, not running" }
            guard let fix = model.lastFix else { return "Waiting for GPS — try outdoors" }
            guard Date().timeIntervalSince(fix.timestamp) <= 15 else { return "GPS stale — waiting for update" }
            return fix.accuracyMeters <= 40 ? String(format: "GPS ready · ±%.0f m", fix.accuracyMeters) : String(format: "Weak GPS · ±%.0f m — try outdoors", fix.accuracyMeters)
        case .notDetermined: return "Not yet allowed"
        case .denied: return "Denied — change in Settings"
        case .restricted: return "Restricted on this device"
        }
    }

    private func row(_ title: String, value: String, ok: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(ok ? .green : .orange)
            Text(title).bold()
            Spacer()
            Text(value).multilineTextAlignment(.trailing).foregroundStyle(.secondary)
        }
    }
}

struct ReceivedHazardView: View {
    @EnvironmentObject private var model: AppModel
    let report: IncomingHazard

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("FROM YOUR CONVOY", systemImage: "car.2.fill")
                .font(.caption.bold()).foregroundStyle(PudleTheme.purple)
            Label(report.title, systemImage: "exclamationmark.triangle.fill")
                .font(.title2.bold()).foregroundStyle(PudleTheme.danger)
            Text(report.message).font(.title3)
            if report.blocksRoad, model.detour != nil {
                Button("Open reviewed detour in Google Maps") {
                    model.incomingHazard = nil
                    model.reroute()
                }.buttonStyle(.borderedProminent).controlSize(.large)
            }
            Button {
                model.incomingHazard = nil
            } label: {
                Text("Got it").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(.borderedProminent).controlSize(.large)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(PudleTheme.ivory)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
