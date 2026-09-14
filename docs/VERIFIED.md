# Pudle MVP verification

Verified on 2026-09-14 against the isolated local D1 configured by `PUDLE_LOCAL_STATE_PATH`. No shared or remote database was reset, migrated, or modified.

## Automated checks

Run from the repository root with Node.js 22.13 or newer:

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Final results:

- ESLint: passed after removing all warnings introduced by this work.
- TypeScript: passed.
- Server tests: 50 passed.
- Client tests: 83 passed across 17 files.
- Total tests: 133 passed.
- Production build: passed. Vinext emitted only the known non-failing client chunk-size advisory.
- Diff whitespace check: passed.

Automated Pudy tests use controlled mock `SpeechRecognition`, `SpeechSynthesisUtterance`, and speech-synthesis objects. They verify cancellation on stop, hidden tab, and unmount; suppression of stale and superseded action responses; synchronous recognition-start errors; and rejected actions. They do not prove physical microphone capture or a browser vendor's transcription service.

Route regressions render both entry points: `/` contains the public product pitch and CTAs into `/app`; `/app` retains authenticated session restoration and the complete product lifecycle.

Release wiring adds a separate Vercel reverse-proxy configuration under `deploy/vercel`, explicitly uncached API responses, configured canonical metadata, and a PWA launch path of `/app`. The canonical-origin tests reject malformed, credential-bearing, and insecure public URLs. Hosting status must be verified separately from these local checks.

## Browser-tested at `http://localhost:4173`

- Fresh isolated Chromium profiles loaded the editorial landing page at `/` and the existing sign-in product shell at `/app`. A 500×900 phone-sized capture confirmed the landing hierarchy, CTAs, compact copy, and no visible horizontal clipping. No device permission or account credential was used for this route check.
- Two independent browser contexts restored distinct Driver and Passenger server sessions.
- Loopback HTTP used the local-only session cookie; production requests retain the `Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-` cookie.
- The 320px viewport with a scrollbar measured `clientWidth = scrollWidth = bodyWidth = 305px`, with no horizontal clipping or browser errors.
- The 390px Ride flow completed an email-bound invite, Passenger join, bidirectional persisted messages, polling, reload, and member isolation.
- A synthetic local video stream exercised the real `MediaRecorder` and account-scoped IndexedDB path: record, elapsed state, stop, save, metadata sync, playback, and export. Playback loaded a 9.7-second WebM with no media error.
- The in-app recording deletion dialog was tested with Cancel and Confirm against only the synthetic clip. Confirm removed the local clip and returned the library to its empty state.
- Demo mode exposed **Use demo area** without requesting device GPS. Passenger prepared a report through Pudy, reviewed it before sharing, and explicitly created one synthetic Road hazard.
- Driver saw the report in the same coarse demo area and acknowledged it. The disabled acknowledgement state survived leaving and returning to Drive.
- Passenger reloaded, selected the demo area again, recovered both `Acknowledged` and `Resolve my report` from the authenticated server response, resolved the report, and observed an empty feed.
- Pudy returned the grounded nearby answer `Road hazard · Within ½ mile` and displayed the speaking state.
- An expired Driver session with a live synthetic camera track returned to sign-in and left the track in the `ended` state.
- Cloud analysis remained visibly **Unconfigured** and could not be enabled.

## Explicit verification limits

- No `GEMINI_API_KEY` was supplied. No live Gemini request, paid upgrade, overage, or fixture presented as cloud output occurred.
- Physical rear-camera quality, physical microphone capture, browser-vendor speech transcription, and audible device TTS still require a presentation-phone check. The media browser test used a synthetic video-only stream and uploaded no private media.
- Export was triggered through the browser download control; the downloaded file was not opened outside the browser automation.
- The production build still reports the existing client bundle chunk-size advisory.

## Repeatable local demo

Use a fresh ignored state directory and never add `--remote`:

```bash
export PUDLE_LOCAL_STATE_PATH="$PWD/.pudle-local/demo-$(date +%Y%m%d-%H%M%S)"
export APP_ORIGIN=http://localhost:4173
export DEMO_MODE=true
export DEMO_RESET_SECRET='choose-a-local-reset-secret'
export DEMO_DRIVER_PASSWORD='choose-a-driver-password'
export DEMO_PASSENGER_PASSWORD='choose-a-passenger-password'

npm run db:migrate:local -- --persist-to "$PUDLE_LOCAL_STATE_PATH"
npm run dev -- --host 127.0.0.1 --port 4173
```

In another terminal:

```bash
curl --fail-with-body -X POST http://localhost:4173/api/demo/reset \
  -H 'Origin: http://localhost:4173' \
  -H 'X-Pudle-CSRF: 1' \
  -H "X-Demo-Reset-Secret: $DEMO_RESET_SECRET"
```

Open `/`, follow **Open Pudle** to `/app`, then use two independent `/app` browser contexts. Sign in as `driver@demo.pudle.local` and `passenger@demo.pudle.local` with the configured passwords, and follow the 60–90 second demo in `README.md`. Use **Use demo area** for nearby-event demonstrations without sharing device GPS.
