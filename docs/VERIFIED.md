# Pudle MVP verification

The latest automated checks ran on September 16, 2026. Earlier browser and hosted
checks below are dated historical evidence, not a claim that the new model has
been tested on a physical phone. Tests did not reset or modify a shared database.

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
- Server tests: 52 passed.
- Client tests: 107 passed across 24 files.
- Total tests: 159 passed.
- Production build: passed. Vinext emitted only the known non-failing client chunk-size advisory.
- Public landing export: passed and generated the static landing HTML/CSS plus public icons in the ignored Vercel output directory.
- Synthetic local-model evaluation: passed with bounded fixture validation and measured per-fixture latency. These fixtures validate software behavior, not road-scene accuracy.
- Real SmolVLM smoke: the exact pinned `HuggingFaceTB/SmolVLM-256M-Instruct`
  revision loaded through Transformers.js 4.3.0 and generated tokens from
  nonprivate synthetic 64×64 pixels. On this development Mac, the warm-cache,
  network-blocked CPU run loaded in 521 ms, inferred 16 tokens in 1,106 ms,
  and observed process RSS of 952,369,152 bytes at its largest sample.
  It made zero network attempts. This proves model execution only, not browser
  WebGPU support, target-phone performance, semantic correctness, or road accuracy.
- Full `npm audit`: zero known vulnerabilities, including development dependencies.
  React/RSC, Vite, and Transformers.js were updated; targeted transitive overrides
  cover image-size, sharp, undici, ws, and esbuild. Audit results are a dated
  dependency check, not a guarantee of security.
- Drizzle generation: no schema changes and no new migrations.
- Metadata scoring CLI: passed on three explicitly synthetic cases. These are
  fabricated predictions/latencies and are not comparative model results.
- Diff whitespace check: passed.

Automated Pudy tests use controlled mock `SpeechRecognition`, `SpeechSynthesisUtterance`, and speech-synthesis objects. They verify cancellation on stop, hidden tab, and unmount; suppression of stale and superseded action responses; synchronous recognition-start errors; and rejected actions. They do not prove physical microphone capture or a browser vendor's transcription service.

Route regressions render both entry points: `/` contains the public product pitch and CTAs into `/app`; `/app` retains authenticated session restoration and the complete product lifecycle.

The release includes a static landing export and Vercel gateway under `deploy/vercel`. Only `/app`, APIs, and Vinext assets are proxied to the Worker; API responses are uncached. Worker metadata uses the configured origin, and the PWA launches at `/app`. Canonical-origin tests reject malformed, credential-bearing, and insecure public URLs. The static landing's canonical URL is set separately in `scripts/build-landing.ts`.

## Browser checks — September 16

- The stale preview rendered but sign-up returned 500. A restarted preview with
  all six migrations in a fresh temporary local database returned 201 for a
  synthetic QA signup and restored the authenticated session on reload.
- Typed “Hey Pudy gas prices are important to me” enabled the fuel-price
  interest in Profile. A labeled synthetic price note displayed its source and
  expiry. Reload preserved the account session but cleared interests and notes.
- At 390px, `clientWidth` and `scrollWidth` were both 390; no error overlay or
  page error was observed in the Profile flow. No camera, microphone, location,
  or production-account permission was used.
- A real worker-construction check found Vinext rewriting `import.meta.url` to
  a `file:` URL. The factory now uses a Vite worker URL import. A separate,
  development-only compatibility hook replaces Vite's page-client import for
  ONNX's URL-query helper; its scope and URL behavior have regression tests.
- The exact compiled worker ran real WebGPU inference in isolated desktop
  Chromium against generated 64×64 pixels: 20,049 ms model load and 2,532 ms
  inference, with a nonempty result. The worker was terminated afterward.
  This was a production-asset harness, not a physical camera, a phone test,
  road accuracy, or evidence of safety. CPU and GPU timings used different
  quantization/token budgets and are not a controlled speed comparison.

## Previous hosted release checks — September 14

The application source was `3e543e9a8bb2af4ef1cb779c08d81510b74d918d`, merged through [PR #1](https://github.com/darssan-eswar/pudle/pull/1). Both the [release PR check](https://github.com/darssan-eswar/pudle/actions/runs/34879715829) and [post-merge check](https://github.com/darssan-eswar/pudle/actions/runs/34879923448) passed.

- Sites version 3 deployed successfully with runtime environment revision 1.
- The live D1 schema contains the account, session, recording, report, group, invite, membership, message, analysis, rate-limit, and idempotency tables.
- The public Vercel landing rendered at desktop width and at 390 × 844. The product sections and **How it works** link were checked visually.
- **Open Pudle** reached the existing ChatGPT access gate. Signing in with the existing owner account reached the deployed Pudle account screen. No Pudle console errors were observed in that flow.
- The backend remained owner-private. `DEMO_MODE=false`; no production demo reset or provider key was enabled.

These are deployment and sign-in-screen checks, not proof of the complete two-user flow on the public Vercel origin. That still depends on the access decision and a new live check. [Current hosting status](DEPLOYMENT.md)

## Previous browser checks — September 14, `http://localhost:4173`

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
- The SmolVLM browser lifecycle is covered with controlled workers for consent,
  unsupported capability, progress, single-flight generation, timeout,
  prohibited output, and unload behavior. Physical-phone WebGPU memory, thermal,
  battery, and road-clip quality gates remain unverified.
- The earlier Transformers.js dependency advisories are resolved in the current
  lockfile. Browser caching tests use controlled Cache API objects; zero-network
  real inference was checked on Node CPU, not a physical phone browser.
- A full offline page reload is not supported: there is no service-worker app
  shell, and session restoration needs the backend. Cached model loading is a
  separate capability. Trip memory is intentionally cleared on page reload.
- Physical rear-camera quality, physical microphone capture, browser-vendor speech transcription, and audible device TTS still require a presentation-phone check. The media browser test used a synthetic video-only stream and uploaded no private media.
- Export was triggered through the browser download control; the downloaded file was not opened outside the browser automation.
- The production build still reports the existing client bundle chunk-size advisory.

## Repeatable local demo

Follow [local setup](SETUP.md) with a fresh ignored state directory. Never add `--remote` to the demo migration command. The setup guide also explains how to carry the reset secret into the second terminal.

Use separate browser profiles for the Driver and Passenger accounts, then follow the [demo sequence](SUBMISSION.md). **Use demo area** demonstrates nearby reports without requesting real GPS.
