# Pudle MVP verification

The local checks below ran on September 14, 2026 against isolated D1 state configured by `PUDLE_LOCAL_STATE_PATH`. Those checks did not reset or modify a shared database. The later hosted release applied production migrations separately, as recorded below.

## Automated checks

Run from the repository root with Node.js 22.13 or newer:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:landing
git diff --check
```

Release results:

- ESLint: passed.
- TypeScript: passed.
- Server tests: 50 passed.
- Client tests: 83 passed across 17 files.
- Total tests: 133 passed.
- Production build: passed. Vinext emitted only the known non-failing client chunk-size advisory.
- Public landing export: passed and generated the static landing HTML/CSS plus public icons in the ignored Vercel output directory.
- Diff whitespace check: passed.

Automated Pudy tests use controlled mock `SpeechRecognition`, `SpeechSynthesisUtterance`, and speech-synthesis objects. They verify cancellation on stop, hidden tab, and unmount; suppression of stale and superseded action responses; synchronous recognition-start errors; and rejected actions. They do not prove physical microphone capture or a browser vendor's transcription service.

Route regressions render both entry points: `/` contains the public product pitch and CTAs into `/app`; `/app` retains authenticated session restoration and the complete product lifecycle.

The release includes a static landing export and Vercel gateway under `deploy/vercel`. Only `/app`, APIs, and Vinext assets are proxied to the Worker; API responses are uncached. Worker metadata uses the configured origin, and the PWA launches at `/app`. Canonical-origin tests reject malformed, credential-bearing, and insecure public URLs. The static landing's canonical URL is set separately in `scripts/build-landing.ts`.

## Hosted release checks

The application source was `3e543e9a8bb2af4ef1cb779c08d81510b74d918d`, merged through [PR #1](https://github.com/darssan-eswar/pudle/pull/1). Both the [release PR check](https://github.com/darssan-eswar/pudle/actions/runs/34879715829) and [post-merge check](https://github.com/darssan-eswar/pudle/actions/runs/34879923448) passed.

- Sites version 3 deployed successfully with runtime environment revision 1.
- The live D1 schema contains the account, session, recording, report, group, invite, membership, message, analysis, rate-limit, and idempotency tables.
- The public Vercel landing rendered at desktop width and at 390 × 844. The product sections and **How it works** link were checked visually.
- **Open Pudle** reached the existing ChatGPT access gate. Signing in with the existing owner account reached the deployed Pudle account screen. No Pudle console errors were observed in that flow.
- The backend remained owner-private. `DEMO_MODE=false`; no production demo reset or provider key was enabled.

These are deployment and sign-in-screen checks, not proof of the complete two-user flow on the public Vercel origin. That still depends on the access decision and a new live check. [Current hosting status](DEPLOYMENT.md)

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

Follow [local setup](SETUP.md) with a fresh ignored state directory. Never add `--remote` to the demo migration command. The setup guide also explains how to carry the reset secret into the second terminal.

Use separate browser profiles for the Driver and Passenger accounts, then follow the [demo sequence](SUBMISSION.md). **Use demo area** demonstrates nearby reports without requesting real GPS.
