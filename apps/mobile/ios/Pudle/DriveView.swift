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
                    primaryControls
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
                row("Network", value: model.online ? "Connected" : "Offline", ok: model.online)
                row("Notifications", value: model.notificationsAllowed ? "Allowed (Mute/Stop controls)" : "Off — no lock-screen controls", ok: model.notificationsAllowed)
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
