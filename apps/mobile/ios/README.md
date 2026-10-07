# Pudle for iPhone (native driving companion)

SwiftUI app + `PudleCore` Swift package. iPhone first; Android is a later phase.

## What it does

| Car | Pudle state | What happens |
|---|---|---|
| Lead car (camera) | Pudle **on screen**, phone mounted facing the road, *Dashcam* on | About 1 frame/s goes to the `detect-hazard` edge function (Gemini). After 2 agreeing frames (or 1 very confident one), Pudle asks: *"Possible object on the right side of the road coming up… Say report it, or cancel."* It listens ~7 s (Apple speech recognition, on-device when supported). "Report it" sends a `driver_confirmed_camera` report with the GPS fix **from when the frame was captured**, side, and possible-blockage flag. |
| Following car | Google Maps in front, Pudle **in background** (blue location indicator) | Pudle polls the convoy feed every 2 s. Each report is matched against this phone's GPS and the convoy's **recorded demo road**: same road, same direction, ≤ 2 km (~1.25 mi) ahead → *"Heads up. Something on the right side of the road, about a mile ahead, reported by a Pudle driver."* Possible blockages also post a **Reroute** notification. |
| Following car, blockage | Tap the notification (or the in-app card) | Pudle opens Google Maps to the saved destination **via the reviewed detour waypoint**. |

Spoken text is always deterministic (`AlertPhrases`); Gemini only renders the voice (`speak` function) and classifies frames. Unlocated reports are never called "ahead". Blockages are always "possible".

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

Applied: `supabase/migrations/202609250001_convoy_obstacles.sql`, `202610070001_hazard_events_v1.sql`.
Edge functions: `supabase/functions/detect-hazard`, `supabase/functions/speak` (JWT required).
Secret required: **`GEMINI_API_KEY`** (Project Settings → Edge Functions → Secrets). Optional: `GEMINI_VISION_MODEL` (default `gemini-3.8-flash`), `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`).
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
5. App Privacy (App Store Connect): Precise Location (app functionality, linked to user, shared with convoy only for confirmed reports), User ID / email (account), Photos or videos: **not collected** (frames are processed and discarded by the edge function and Gemini; review Google's API data terms for your billing tier).
6. Internal testers get the build after processing (often minutes, sometimes longer). External testers need Beta App Review. Same-day availability is not guaranteed.
7. TestFlight does not grant extra background rights: the same lifecycle limits apply.

## Known limits

- Dashcam requires Pudle in the foreground (iOS camera rule). The receiving phone works in the background only while iOS keeps delivering its location (When-In-Use + blue indicator). Force-quitting stops everything.
- Polling, not push: receive latency ≈ 0–2 s poll + network. Measure with Delivery log → Export evidence.
- Road matching uses a recorded line, not a map; very close parallel lanes/ramps can still be ambiguous.
- Gemini confidence is self-reported, not measured accuracy. Validate on footage from the actual demo road.
- Rerouting reopens Google Maps with a waypoint; Google Maps chooses the actual route. Review it before recording.
