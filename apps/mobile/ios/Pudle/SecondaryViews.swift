import SwiftUI
import PudleCore

/// Hand-confirmed report, for a passenger or a stopped car. Never requires the driver
/// to interact while moving.
struct ReportView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmedNotDriving = false
    @State private var sending = false

    var body: some View {
        NavigationStack {
            Form {
                if model.isMoving {
                    Section {
                        Toggle("I am a passenger, not the driver", isOn: $confirmedNotDriving)
                    } footer: {
                        Text("This phone is moving. Drivers should not send reports while driving.")
                    }
                }
                Section {
                    ForEach(HazardKind.allCases, id: \.self) { kind in
                        Button(AlertPhrases.label(kind)) {
                            Task {
                                sending = true
                                if await model.sendReport(kind: kind) { dismiss() }
                                sending = false
                            }
                        }
                        .disabled(sending || (model.isMoving && !confirmedNotDriving))
                    }
                } footer: {
                    Text(model.shareLocationWithReports
                         ? "Your current position (not your route) is attached so receivers can tell whether it's on their heading. Reports expire after a few minutes."
                         : "No location is attached. Receivers will hear “location not verified”. You can opt in under Settings.")
                }
            }
            .navigationTitle("Report a hazard")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var joinCode = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if !model.backendConfigured {
                        Text("This build has no backend configured. Only labeled test alerts are available.")
                            .foregroundStyle(.secondary)
                    } else if let signed = model.signedInEmail {
                        LabeledContent("Signed in", value: signed)
                        Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    } else {
                        TextField("Email", text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                        Button("Sign in") {
                            Task { await model.signIn(email: email, password: password); password = "" }
                        }
                        .disabled(email.isEmpty || password.isEmpty)
                        Text("Use the account you created in the Pudle web app.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if model.isSignedIn {
                    Section("Convoy") {
                        Picker("Listening to", selection: $model.selectedConvoyID) {
                            Text("None").tag(String?.none)
                            ForEach(model.convoys) { convoy in Text(convoy.name).tag(String?.some(convoy.id)) }
                        }
                        HStack {
                            TextField("12-character invite code", text: $joinCode)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                            Button("Join") { Task { await model.joinConvoy(code: joinCode); joinCode = "" } }
                                .disabled(joinCode.count < 12)
                        }
                        Button("Refresh convoys") { Task { await model.loadConvoys() } }
                    }
                    Section {
                        Toggle("Attach my position to reports I send", isOn: Binding(
                            get: { model.shareLocationWithReports },
                            set: { value in Task { await model.setShareLocation(value) } }))
                    } header: {
                        Text("Location sharing")
                    } footer: {
                        Text("Off by default. When on, only the single position at the moment you send a report is shared with your convoy, and it is deleted with the report (within about an hour). Your route and movement are never uploaded.")
                    }
                }
                Section("Speech") {
                    Picker("Distances", selection: $model.units) {
                        Text("Feet / miles").tag(DistanceUnits.imperial)
                        Text("Meters / km").tag(DistanceUnits.metric)
                    }
                }
                Section("Build") {
                    LabeledContent("Version", value: model.config.versionDescription)
                    LabeledContent("Located reports", value: model.hazardEventsAvailable ? "Supported by backend" : "Backend migration missing")
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { if model.isSignedIn { await model.loadConvoys() } }
        }
    }
}

struct DiagnosticsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section {
                let latencies = model.spokenLatencies
                if let p50 = LatencyStats.percentile(latencies, 50), let p95 = LatencyStats.percentile(latencies, 95) {
                    Text(String(format: "Receipt → speech start: n=%d · median %.2fs · p95 %.2fs", latencies.count, p50, p95))
                } else {
                    Text("No spoken alerts yet.")
                }
                ShareLink(item: model.evidenceReport()) { Label("Export evidence (no locations)", systemImage: "square.and.arrow.up") }
            }
            Section("Deliveries") {
                ForEach(model.deliveries) { record in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(record.outcome.rawValue.capitalized) · \(record.source == .labeledTest ? "TEST" : "convoy") · \(record.kind.rawValue)")
                            .font(.callout.bold())
                        Text("\(record.receivedAt.formatted(date: .omitted, time: .standard)) · \(record.appState)")
                            .font(.caption)
                        Text(record.note).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Session notes") {
                ForEach(model.diagnostics) { line in
                    Text("\(line.at.formatted(date: .omitted, time: .standard))  \(line.text)").font(.caption)
                }
            }
        }
        .navigationTitle("Evidence")
    }
}

struct LimitationsView: View {
    var body: some View {
        List {
            Section("What works") {
                Text("Spoken reports while Google Maps or another app is in front, during a drive you started, while iOS keeps delivering Pudle's location (blue indicator visible).")
                Text("Mute and Stop drive from the notification (long-press it) or inside Pudle.")
            }
            Section("What Pudle does not do") {
                Text("It does not see the road. Reports come from convoy members or are labeled tests.")
                Text("It does not read Google Maps or your route.")
                Text("A report without a position is never described as ahead of you.")
                Text("“Ahead on your heading” is based on positions and directions, not a map. Very close parallel lanes or ramps cannot be excluded.")
                Text("No braking, steering, emergency calls, face or plate recognition.")
            }
            Section("When alerts can be missed") {
                Text("If you deny location, force-quit Pudle, or iOS ends it, alerts stop until you reopen Pudle and start a drive.")
                Text("Offline means new reports cannot arrive. Silence is not an all-clear.")
                Text("During a phone call, iOS may block spoken audio. Pudle then shows a notification instead.")
                Text("Silent mode / Focus settings and Bluetooth routing are controlled by iOS; check the delivery log.")
            }
        }
        .navigationTitle("Limitations")
    }
}
