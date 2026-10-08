import SwiftUI
import PudleCore

/// Hand-confirmed report, for a passenger or a stopped car. Never requires the driver
/// to interact while moving.
struct ReportView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmedNotDriving = false
    @State private var sending = false
    @State private var side: HazardSide = .unknown
    @State private var blocksRoad = false

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
                Section("Details") {
                    Picker("Side of road", selection: $side) {
                        Text("Unknown").tag(HazardSide.unknown)
                        Text("Left").tag(HazardSide.left)
                        Text("Middle").tag(HazardSide.center)
                        Text("Right").tag(HazardSide.right)
                    }
                    Toggle("May block the road", isOn: $blocksRoad)
                }
                Section {
                    ForEach(HazardKind.allCases, id: \.self) { kind in
                        Button(AlertPhrases.label(kind)) {
                            Task {
                                sending = true
                                if await model.sendReport(kind: kind, side: side, blocksRoad: blocksRoad) { dismiss() }
                                sending = false
                            }
                        }
                        .disabled(sending || (model.isMoving && !confirmedNotDriving))
                    }
                } footer: {
                    Text(model.shareLocation
                         ? "Your current position (not your route) is attached so receivers can tell whether it's ahead of them. Reports expire after 15–30 minutes."
                         : "No location is attached. Receivers will hear “location not verified”. You can opt in under Settings.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(PudleTheme.ivory)
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
    @State private var newConvoyName = "Demo convoy"
    @State private var roadName = "Demo road"
    @State private var placeQuery = ""
    @State private var placeResults: [SavedPlace] = []
    @State private var choosingDetour = false

    var body: some View {
        NavigationStack {
            Form {
                accountSection
                if model.isSignedIn {
                    convoySection
                    locationSection
                    roadSection
                }
                routeSection
                Section("Voice") {
                    Picker("Personality", selection: $model.persona) {
                        ForEach(Persona.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    Toggle("Gemini voices (falls back to iPhone voice)", isOn: $model.cloudVoices)
                    Picker("Distances", selection: $model.units) {
                        Text("Feet / miles").tag(DistanceUnits.imperial)
                        Text("Meters / km").tag(DistanceUnits.metric)
                    }
                }
                Section("Build") {
                    LabeledContent("Version", value: model.config.versionDescription)
                }
            }
            .scrollContentBackground(.hidden)
            .background(PudleTheme.ivory)
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { if model.isSignedIn { await model.loadConvoys() } }
        }
    }

    private var accountSection: some View {
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
                SecureField("Password (8+ characters)", text: $password)
                    .textContentType(.password)
                HStack {
                    Button("Sign in") {
                        let accountEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
                        let accountPassword = password
                        Task { await model.signIn(email: accountEmail, password: accountPassword) }
                    }.buttonStyle(.bordered)
                    Spacer()
                    Button("Create account") {
                        let accountEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
                        let accountPassword = password
                        Task { await model.signUp(email: accountEmail, password: accountPassword) }
                    }.buttonStyle(.bordered)
                }
                .disabled(model.accountBusy || email.isEmpty || password.count < 8)
                if model.accountBusy { ProgressView("Connecting…") }
                Text("Create a Pudle account with a new password. Confirm the email before signing in; your Google account password is not used here.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var convoySection: some View {
        Section {
            Picker("Listening to", selection: $model.selectedConvoyID) {
                Text("None").tag(String?.none)
                ForEach(model.convoys) { convoy in Text(convoy.name).tag(String?.some(convoy.id)) }
            }
            if let code = model.selectedConvoy?.join_code {
                LabeledContent("Invite code") {
                    Text(code).font(.body.monospaced()).textSelection(.enabled)
                }
            }
            HStack {
                TextField("12-character invite code", text: $joinCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Button("Join") { Task { await model.joinConvoy(code: joinCode); joinCode = "" } }
                    .disabled(joinCode.count < 12)
            }
            HStack {
                TextField("New convoy name", text: $newConvoyName)
                Button("Create") { Task { await model.createConvoy(name: newConvoyName) } }
                    .disabled(newConvoyName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        } header: {
            Text("Convoy")
        } footer: {
            Text("Only members of the same convoy receive each other's reports. Convoys last 24 hours.")
        }
    }

    private var locationSection: some View {
        Section {
            Toggle("Share hazard locations with my convoy", isOn: Binding(
                get: { model.shareLocation },
                set: { value in Task { await model.setShareLocation(value) } }))
        } header: {
            Text("Location sharing")
        } footer: {
            Text("Needed for camera reports and the demo road. Confirmed hazard positions and the demo road you explicitly record are shared with your convoy. Reports expire after 15–30 minutes; expiry does not guarantee immediate deletion. Routine positions remain on this phone. Turning this off removes positions from your stored reports.")
        }
    }

    private var roadSection: some View {
        Section {
            if let corridor = model.corridor {
                LabeledContent("Active", value: String(format: "%@ · %.1f km", corridor.name, corridor.lengthMeters / 1000))
            }
            if model.recordingRoad {
                LabeledContent("Recording", value: "\(model.recordedPoints) points")
                TextField("Road name", text: $roadName)
                Button("Finish and save road") { Task { await model.finishRecordingRoad(name: roadName) } }
            } else {
                Button("Record demo road (drive it once)") { model.startRecordingRoad() }
                    .disabled(model.phase != .active)
            }
        } header: {
            Text("Demo road")
        } footer: {
            Text("Start a drive, tap Record, and drive the demo road in the direction cars will travel. Pudle then warns following cars only when they are on this road, going the same way, within about a mile of the hazard. The recorded line is shared with your convoy for 7 days.")
        }
    }

    private var routeSection: some View {
        Section {
            LabeledContent("Destination", value: model.destination?.name ?? "Not set")
            LabeledContent("Detour waypoint", value: model.detour?.name ?? "Not set")
            Picker("Search sets", selection: $choosingDetour) {
                Text("Destination").tag(false)
                Text("Detour").tag(true)
            }
            .pickerStyle(.segmented)
            HStack {
                TextField("Search a place or address", text: $placeQuery)
                    .autocorrectionDisabled()
                Button("Search") { Task { placeResults = await model.searchPlaces(placeQuery) } }
                    .disabled(placeQuery.isEmpty)
            }
            ForEach(placeResults, id: \.coordinateString) { place in
                Button(place.name) {
                    if choosingDetour { model.detour = place } else { model.destination = place }
                    placeResults = []
                    placeQuery = ""
                }
            }
            Button("Use my current position as the detour point") { model.useCurrentPositionAsDetour() }
            if model.detour != nil { Button("Clear detour", role: .destructive) { model.detour = nil } }
        } header: {
            Text("Demo route (for reroute)")
        } footer: {
            Text("Pudle can't change Google Maps' active route. On a blockage it offers to reopen Google Maps to this destination through your reviewed detour point. Google Maps then plans the actual route — check it before recording.")
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
                if let p50 = LatencyStats.percentile(model.detectorLatencies, 50),
                   let p95 = LatencyStats.percentile(model.detectorLatencies, 95) {
                    Text(String(format: "Frame → Gemini answer: n=%d · median %.2fs · p95 %.2fs", model.detectorLatencies.count, p50, p95))
                }
                ShareLink(item: model.evidenceReport()) { Label("Export evidence (no locations)", systemImage: "square.and.arrow.up") }
            }
            Section("Deliveries") {
                ForEach(model.deliveries) { record in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(record.outcome.rawValue.capitalized) · \(record.source == .labeledTest ? "TEST" : record.source.rawValue) · \(record.kind.rawValue)")
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
        .scrollContentBackground(.hidden)
            .background(PudleTheme.ivory)
            .navigationTitle("Evidence")
    }
}

struct LimitationsView: View {
    var body: some View {
        List {
            Section("What works") {
                Text("Designed to speak reports while another app is in front during an active drive. Requires iOS location updates and network availability; verify on your phones before recording.")
                Text("Dashcam mode sends a frame to Gemini every 15 seconds. Free-tier provider data policies apply. Pudle asks before sending a hazard report to your convoy; answer by voice or tap.")
                Text("Mute, Stop drive and Reroute from the notification (long-press it) or inside Pudle.")
            }
            Section("What Pudle does not do") {
                Text("Camera detections are possible observations, not measured accuracy. Misses and false alarms happen.")
                Text("The dashcam only runs while Pudle is on screen (iOS rule).")
                Text("It does not read Google Maps or your route, and cannot change Google Maps' route by itself.")
                Text("A report without a position is never described as ahead of you.")
                Text("“Ahead” uses the recorded demo road when available, otherwise positions and headings. Parallel roads and ramps can still confuse it.")
                Text("No braking, steering, emergency calls, face or plate recognition. Camera frames are not stored.")
            }
            Section("When alerts can be missed") {
                Text("If you deny location, force-quit Pudle, or iOS ends it, alerts stop until you reopen Pudle and start a drive.")
                Text("Offline means new reports cannot arrive. Silence is not an all-clear.")
                Text("During a phone call, iOS may block spoken audio. Pudle then shows a notification instead.")
            }
        }
        .scrollContentBackground(.hidden)
            .background(PudleTheme.ivory)
            .navigationTitle("Limitations")
    }
}
