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
                VStack(spacing: 16) {
                    StatusCard(line: DriveStatusText.headline(model.snapshot))
                    if let blockage = model.activeBlockage { BlockageCard(event: blockage) }
                    primaryControls
                    DashcamCard()
                    if model.phase == .active { CapabilityList() }
                    testControls
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
            .navigationTitle("Pudle")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
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
                .tint(.green)
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
                    .tint(.red)
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
                Toggle("Dashcam hazard spotting", isOn: Binding(get: { model.dashcamEnabled }, set: { model.setDashcam($0) }))
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
                if let prompt = model.cameraPrompt { PromptCard(prompt: prompt) }
                Text(model.dashcamEnabled ? model.detectorStatus
                     : "Mount the phone facing the road. Pudle checks about one frame per second with Gemini and asks you before sharing anything. Keep Pudle on screen: iOS pauses the camera otherwise.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } label: {
            Label("Dashcam", systemImage: "camera.viewfinder")
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
            if prompt.phase != .sending {
                HStack {
                    Button("Report it") { model.confirmCameraReport() }.buttonStyle(.borderedProminent)
                    Button("Cancel", role: .cancel) { model.cancelCameraReport() }.buttonStyle(.bordered)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
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
                Label(model.detour == nil ? "Open Google Maps" : "Reroute via detour in Google Maps", systemImage: "arrow.triangle.branch")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.18), in: RoundedRectangle(cornerRadius: 14))
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
            Text(line.title).font(.title3.bold())
            Text(line.detail).font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(color, lineWidth: 2))
        .accessibilityElement(children: .combine)
    }

    private var color: Color {
        switch line.tone {
        case .good: return .green
        case .warning: return .orange
        case .problem: return .red
        case .neutral: return .gray
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
        case .whenInUse, .always: return model.snapshot.backgroundLocationRunning ? "On for this drive" : "Allowed, not running"
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
