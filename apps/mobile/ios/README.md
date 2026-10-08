# Pudle for iPhone (native driving companion)

SwiftUI app + `PudleCore` Swift package. iPhone first; Android is a later phase.

## What it does

| Car | Pudle state | What happens |
|---|---|---|
| Lead car (camera) | Pudle **on screen**, phone mounted facing the road, *Dashcam* on | One frame every 15 seconds by default (optional 3-second demo mode and Check now) goes to the `detect-hazard` edge function (Gemini). After 2 agreeing frames (or 1 very confident one), Pudle asks: *"Possible object on the right side of the road coming up… Say report it, or cancel."* It listens ~7 s (Apple speech recognition, on-device when supported). "Report it" sends a `driver_confirmed_camera` report with the GPS fix **from when the frame was captured**, side, and possible-blockage flag. |
| Following car | Google Maps in front, Pudle **in background** (blue location indicator) | Pudle checks the convoy feed on a foreground timer and background location callbacks (at most once every 2 s). Each report is matched against this phone's GPS and the convoy's **recorded demo road**: same road, same direction, ≤ 1 mile ahead → *"Heads up. Something on the right side of the road, about a mile ahead, reported by a Pudle driver."* Possible blockages also post a **Reroute** notification. |
| Following car, blockage | Tap the notification (or the in-app card) | Pudle opens Google Maps to the saved destination **via the reviewed detour waypoint**. |

Hazard alert wording uses `AlertPhrases`; Gemini also provides scene descriptions and natural speech. Natural Gemini voice defaults on, with installed iPhone voice fallback. Unlocated reports are never called "ahead". Blockages are always "possible".

## Build and install (Mac with Xcode 26+)

```bash
cd apps/mobile/ios
cp Config/Local.example.xcconfig Config/Local.xcconfig   # fill in team, bundle ID, Supabase URL + publishable key
brew install xcodegen          # or use the release binary from github.com/yonaskolb/XcodeGen
xcodegen generate
open Pudle.xcodeproj           # select your iPhone, Run
```

Core logic tests: `cd PudleCore && swift test`.

- Free Apple ID ("Personal Team") is enough to install on your own phones (apps expire after 7 days).
- Each phone: Settings → Privacy & Security → **Developer Mode** on; trust the Mac when prompted; after first install, Settings → General → VPN & Device Management → trust the developer.

## Backend (Supabase project `pudle`, ref `yibbqhchadapqyquiwrt`)

Claude reported applying: `supabase/migrations/202609250001_convoy_obstacles.sql`, `202610070001_hazard_events_v1.sql`.
Edge functions: `supabase/functions/detect-hazard`, `supabase/functions/speak` (JWT required).
Secret required: **`GEMINI_API_KEY`** (Project Settings → Edge Functions → Secrets). Optional: `GEMINI_VISION_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-lite-tts`).
Optional cleanup: run `202610070002_retention_cleanup.sql` in the SQL editor, then schedule `private.purge_expired_hazard_data()`.
Policy tests: `supabase/tests/run_local.sh` against a throwaway local Postgres.

## First-time demo setup (both phones)

1. Settings → **Create account** (or sign in). If Supabase email confirmation is on, confirm from the email.
2. Phone A: Convoy → **Create**. Read the invite code. Phone B: **Join** with that code.
3. Both: turn on **Share hazard locations with my convoy**.
4. Phone A: **Start drive**, Settings → **Record demo road**, drive the demo road once in the direction of travel, **Finish and save road**. Phone B picks it up automatically (Demo road row shows it).
5. Phone B: Settings → Demo route → set **Destination** and **Detour** (search, or stand at the detour point and tap "Use my current position").
6. Phone B: Start drive → **Navigate in Google Maps** (Pudle goes to background). Phone A: Start drive → Dashcam on → keep Pudle on screen.

## TestFlight checklist (needs the paid Apple Developer Program)

1. App Store Connect → Apps → **+** → new app with your bundle ID (e.g. `in.darss.pudle`).
2. `Config/Local.xcconfig`: `DEVELOPMENT_TEAM`, `PRODUCT_BUNDLE_IDENTIFIER`, bump `CURRENT_PROJECT_VERSION` for every upload.
3. Xcode → Product → **Archive** → Distribute App → App Store Connect → Upload.
4. Answers prepared in `Info.plist`: location/camera/microphone/speech purpose strings; `ITSAppUsesNonExemptEncryption = NO` (only standard HTTPS).
5. App Privacy (App Store Connect): Precise Location (app functionality, linked to user, shared with convoy only for confirmed reports), User ID / email (account), Camera frames: sent to Google for analysis before report confirmation; review Google's API data terms and complete privacy disclosures for your actual configuration. Free-tier content may be used to improve Google products. Pudle requests stateless processing (`store: false`), which does not override provider policy.
6. Internal testers get the build after processing (often minutes, sometimes longer). External testers need Beta App Review. Same-day availability is not guaranteed.
7. TestFlight does not grant extra background rights: the same lifecycle limits apply.

## Known limits

- Dashcam requires Pudle in the foreground (iOS camera rule). The receiving phone works in the background only while iOS keeps delivering its location (When-In-Use + blue indicator). Force-quitting stops everything.
- Polling, not push: background receipt timing depends on iOS location callbacks and network availability; there is no guaranteed 2-second delivery. Measure with Delivery log → Export evidence.
- Road matching uses a recorded line, not a map; very close parallel lanes/ramps can still be ambiguous.
- Gemini confidence is self-reported, not measured accuracy. Validate on footage from the actual demo road.
- Rerouting reopens Google Maps with a waypoint; Google Maps chooses the actual route. Review it before recording.

## Takeover validation (2026-10-07)

Work lives in `/Users/ledarssan/ParkeZeAll/pudle-takeover`, branch `codex/pudle-takeover`.
The simulator app builds and launches, the device app builds and signs with the existing Apple development identity, and all 55 Swift core tests pass. A signed app copy is at `/Users/ledarssan/ParkeZeAll/output/pudle-takeover/Pudle.app`. Physical camera, background audio, voice confirmation, Gemini access and two-phone delivery still require device tests.
Local signing/backend settings are in ignored `Config/Local.xcconfig`. The Gemini key belongs only in Supabase Edge Function secrets.
The edge-function fixes were deployed on 2026-10-07. They validate tokens with Supabase Auth, avoid response-content logging, request stateless Gemini processing, and limit frames per running instance. This is best-effort throttling, not a project-wide cost cap.

### Recording acceptance checks

1. Both phones sign in as different confirmed accounts and join the same private convoy.
2. Start drive on both; confirm fresh accurate GPS and a live feed. Record the demo road in the intended travel direction and confirm both see it.
3. On the receiver, set destination and a reviewed detour, then open Google Maps. Keep Pudle foreground on the camera phone.
4. With a passenger operating the phones on a controlled site, test an existing harmless obstacle in view. Keep the receiver moving on the recorded road in the intended direction; parked camera-report tests intentionally remain silent. Use Faster demo checks or Check now on the lead phone. Wait for a camera check; verify the prompt says possible, and say “report it”. Confirm a single event is sent and receiver speech names the reported side and approximate distance to the observation position.
5. Repeat with “do not report it”; no event should be sent. Stop drive during a pending check; no late prompt should occur.
6. For a possible blockage, confirm the notification opens Pudle and the reviewed Google Maps waypoint route. Verify it actually bypasses the demonstration location.
7. Verify opposite-direction/off-corridor/stale reports are suppressed and a disconnected feed is identified. Export delivery evidence before claiming a live background demonstration.

A free Apple Personal Team can support short direct installs on owned phones; provisioning expires after seven days. TestFlight requires paid Apple Developer Program membership. Camera capture requires foreground; the receiver background path must be measured on real phones.

Live backend verification passed: isolated convoy creation/join, consent, confirmed report delivery, duplicate prevention, outsider isolation, and authenticated Gemini Flash-Lite analysis of a generated blank image. Unauthenticated detector requests return 401. Temporary verification accounts and their records were deleted. Both native apps installed; real-camera accuracy and background spoken delivery still need phone testing.

## Camera-and-voice companion

Start drive, enable Dashcam, and enable Natural Gemini voice. Tap What do you see? to send one fresh frame and hear a short scene description. Talk to Pudle opens a seven-second microphone session for What do you see, Report it or Cancel. This is push-to-talk, with no always-listening wake word. The detecting phone must stay foreground.
Descriptions are observations, not verified navigation or distance measurements. If that frame also flags a possible hazard, Pudle asks for confirmation before sending a report. Report it requires a pending detected hazard. Normal mode requires GPS matched within three seconds of capture; demo mode permits an unlocated convoy-member report. A plain scene description never creates a convoy report. Synthetic lifecycle tests remain separate.
Live tests passed for a generated blank-image description and natural Gemini WAV playback format. Core command parser tests pass. Actual road-scene detection, microphone recognition and background audio still need physical-phone tests.

## Recorded two-phone demo configuration

The native app defaults to **Demo mode** for this MVP. Start a drive on both signed-in phones in the same convoy before sending a new report. Confirmed reports travel through the real authenticated Supabase backend. In demo mode the receiver presents new reports without road, direction or distance filtering; the popup is labeled Demo and does not claim a measured distance. If capture GPS is unavailable, camera confirmation sends an unlocated convoy-member report rather than fabricating coordinates. Disable Demo mode to use normal GPS relevance rules.

The receiving phone shows a hazard sheet while Pudle is foreground, with a Got it button. Background delivery uses local notifications and depends on iOS allowing the driving session to keep running. No remote push service is implemented. A successful send confirms server acceptance, not receiver acknowledgment.

Location status now distinguishes running tracking from a fresh accurate fix. The camera pairs observations with fixes delivered shortly before or after capture. Vision instructions require visible outdoor roadway context before flagging road hazards; model mistakes remain possible. This is a prototype, not a validated driving safety system.

The UI uses the original ivory, lilac, mint and peach palette. Talk to Pudle recognizes scene-description, report and cancel commands; general conversation and live weather are not implemented.

Final validation: both physical-device builds compiled and installed, and the core suite passed 55 tests. The owner recorded demo footage. Automated checks do not establish on-road detection accuracy or reliable background delivery.
