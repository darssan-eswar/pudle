# Pudle

Pudle (**Peer Updated Driving Logic Engine**) is a privacy-first road-intelligence app with the Pudy voice companion. The current MVP provides a mobile local camera scanner, manual road reports, nearby alerts, and a secure authentication/persistence foundation.

## Current implementation

- Public editorial product page at `/`; the authenticated dashcam product lives at `/app`
- Live rear-camera preview and optional on-device TensorFlow.js / COCO-SSD detection
- Manual and edge-assisted road-event metadata, rounded to three decimal places
- Authenticated D1-backed events limited to two miles and 30 minutes, with owner resolution and idempotent acknowledgements
- Invite-only, 24-hour demo ride groups and member-isolated plain-text messaging
- Email/password accounts with PBKDF2-SHA-256 password hashes
- Rotating opaque sessions in `Secure`, `HttpOnly`, `SameSite=Strict` production cookies; loopback HTTP previews use a separate local-only cookie name
- Owner-isolated D1 recording metadata APIs (media is never accepted or stored)
- Explicitly opted-in, bounded still-frame road analysis through the server-only Gemini REST API
- Strict analysis output validation, per-user/IP rate limits, idempotency, recoverable processing leases, timeout, bounded transient retry, and 30-minute logical result retention
- D1 contracts for event acknowledgement/resolution, invite-only groups, messages, idempotency, rate limits, and retention
- Integrated Drive, Recordings, Ride, and Privacy surfaces with account-safe cleanup and explicit permission states
- Nearby report review/confirmation, acknowledgement, owner resolution, and privacy-preserving polling
- Explicitly enabled foreground Pudy voice/text controls grounded only in displayed local, cloud, and nearby observations; “Hey Pudy” listening pauses for replies and whenever the page is hidden

## Privacy model

Pudle never performs face recognition, license-plate recognition, vehicle-owner identification, persistent tracking of other users, or accusations about intoxication, intent, or culpability. Full recordings and raw audio remain local.

Cloud analysis accepts only one JPEG/WebP still per request after a separate explicit opt-in. The total raw request is capped at 512KB, each dimension is capped at 1920px, and the server enforces at least five seconds between accepted frames per user. Video, audio, full recordings, and media blobs are rejected or never accepted. Frame bytes live only in request/provider-call memory and are not persisted by Pudle; application retention for frames is zero after processing. D1 job/result metadata becomes unavailable through the application after 30 minutes, and recording metadata after 24 hours. Physical deletion is opportunistic on relevant API traffic because this deployment has no scheduled cleanup handler; it is not guaranteed at the exact logical-expiry instant. Nearby-event responses omit coordinates.

Opted-in frames are sent by the server to the configured Google Gemini API and are then subject to Google's current Gemini API terms and the billing/account configuration. Under Google's terms effective March 23, 2026, unpaid services may use submitted content and generated responses to improve products and may involve human review; paid services state that prompts and responses are not used to improve products, but are logged for a limited period for abuse prevention and may be processed or cached where Google or its agents operate. Pudle cannot promise provider-side deletion timing. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) before enabling this feature, use a suitable paid account where required, and do not submit sensitive content.

## Local setup

Use Node.js 22.13 or newer:

```bash
npm ci
npm run dev
```

Configure the Cloudflare D1 binding as `DB`. Copy `.env.example` values into the runtime’s server environment; never expose them through client-prefixed variables.

### Fresh isolated local demo

Use a new ignored persistence directory so existing local or remote data is never reset:

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

In another terminal, seed two normal accounts through the same authenticated application stack:

```bash
curl --fail-with-body -X POST http://localhost:4173/api/demo/reset \
  -H 'Origin: http://localhost:4173' \
  -H 'X-Pudle-CSRF: 1' \
  -H "X-Demo-Reset-Secret: $DEMO_RESET_SECRET"
```

This creates `driver@demo.pudle.local` and `passenger@demo.pudle.local` with the two configured passwords. The reset route exists only when `DEMO_MODE=true`; it is rate-limited and uses normal password hashing and server sessions. Do not point these commands at a shared state directory or add `--remote`.

When demo mode is enabled, Drive also shows **Use demo area**. It uses one fixed, visibly labeled coarse test coordinate for both accounts and never requests device geolocation. The normal **Share approximate location** opt-in remains separate. `GET /api/demo/status` returns only `{ "enabled": boolean }`; no reset secret or password is exposed.

`GEMINI_API_KEY` is optional and server-only. With no key, `GET /api/analysis/status` reports `configured: false` and analysis returns `provider_unconfigured`; it never presents a fixture as live output. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Live provider verification remains blocked until a valid key and applicable provider account are supplied.

Apply generated migrations using the deployment environment’s Wrangler/D1 workflow. The schema source of truth is `db/schema.ts`; after changing it:

```bash
npm run db:generate
npm run db:migrate:local -- --persist-to <ISOLATED_STATE_DIRECTORY>
npx wrangler d1 migrations apply <DATABASE_NAME> --remote
```

Use only the command for the intended environment, and replace `<DATABASE_NAME>` with the configured D1 database name. Review every generated SQL migration before applying it. Never commit local Wrangler state or database contents.

## Authentication API

All mutation requests require:

- `Content-Type: application/json` when a body is present
- an `Origin` matching `APP_ORIGIN` (or the request origin when unset)
- `X-Pudle-CSRF: 1`

Endpoints:

| Endpoint | Method | Behavior |
|---|---|---|
| `/api/auth/signup` | `POST` | Creates an account and rotates into a new session |
| `/api/auth/signin` | `POST` | Returns a generic credential error and rotates existing sessions |
| `/api/auth/session` | `GET` | Returns `{ "user": null }` or the minimum public user fields |
| `/api/auth/signout` | `POST` | Invalidates the current token and clears the cookie |
| `/api/demo/status` | `GET` | Returns only whether local demo controls are enabled |
| `/api/demo/reset` | `POST` | Resets demo credentials only under the explicit demo gate |

Clients never provide a trusted user ID. Server routes derive identity from the session cookie. Email is trimmed/lowercased, names and passwords are bounded, and payloads are size/shape checked. Signup, sign-in, event creation, and enabled demo-reset attempts are rate-limited. Sign-out is deliberately not rate-limited so a client can always invalidate its session and clear its cookie.

## Recording metadata API

All endpoints require an authenticated server-verified session. Mutations also require the same Origin and CSRF headers as authentication mutations.

| Endpoint | Method | Behavior |
|---|---|---|
| `/api/recordings?limit=30` | `GET` | Lists up to 100 unexpired metadata records owned by the caller |
| `/api/recordings` | `POST` | Creates metadata from `clientRecordingId`, `durationMs`, `mimeType`, `byteLength`, and `capturedAt` |
| `/api/recordings/:id` | `GET` | Gets one caller-owned metadata record |
| `/api/recordings/:id` | `PATCH` | Updates only `durationMs` and/or `byteLength` |
| `/api/recordings/:id` | `DELETE` | Deletes one caller-owned metadata record and returns 204 |

Only `video/webm` and `video/mp4` labels are accepted as metadata. These JSON endpoints reject unknown fields, including media payloads. Missing and other-user records both return 404.

## Cloud analysis API

`GET /api/analysis/status` requires authentication and returns only `{ configured, provider, model }`; it never returns a credential.

`POST /api/analysis` requires authentication, mutation Origin/CSRF checks, and:

- `Content-Type: image/jpeg` or `image/webp`, with exactly one raw still-image body
- actual body no larger than 512KB (`Content-Length`, when supplied, is only an early rejection hint)
- `X-Pudle-Cloud-Analysis-Consent: true`
- `X-Pudle-Captured-At: <Unix milliseconds>` no older than five minutes or over 30 seconds in the future
- `Idempotency-Key: <8–128 visible ASCII characters>`
- optional `X-Pudle-Recording-Id` for caller-owned metadata

Success returns `{ jobId, result }`, where `result` has deterministic server-derived `summary` and `uncertainty`, allowlisted `observations`, bounded `confidence`, `source`, `model`, `capturedAt`, and `analyzedAt`. Provider-authored free-form text is neither returned nor persisted. Errors distinguish `provider_unconfigured`, `provider_timeout`, `provider_quota`, `provider_error`, and `malformed_provider_response`. Completed/error responses are replayed for the same user/key with `Idempotency-Replayed: true`. Analysis is limited to 12 requests/user/minute, 30 requests/IP/minute, one live leased job/user, and one accepted frame/user/five seconds. A dead worker's 30-second processing lease is reclaimed independently of the 30-minute result/idempotency retention window.

## Shared events and ride APIs

All endpoints below require the server session cookie. Mutations additionally require the same-origin and `X-Pudle-CSRF: 1` checks described above. Event creation, acknowledgement, resolution, and message sends require an `Idempotency-Key` header containing 8–128 URL-safe characters.

| Endpoint | Method | Behavior |
|---|---|---|
| `/api/events?lat=…&lng=…` | `GET` | Returns at most 30 unresolved events no more than two miles away and younger than 30 minutes |
| `/api/events` | `POST` | Creates an allowlisted report after rounding coordinates to three decimals |
| `/api/events/:eventId/ack` | `POST` | Idempotently acknowledges a live event once per authenticated identity |
| `/api/events/:eventId/resolve` | `POST` | Resolves a live event only when the session user owns it |
| `/api/groups` | `GET` | Lists only the caller’s active memberships |
| `/api/groups` | `POST` | Creates an invite-only demo ride group with 24-hour retention |
| `/api/groups/:groupId/invites` | `POST` | Lets the owner create an email-bound invite expiring in 5–1440 minutes |
| `/api/groups/invites/redeem` | `POST` | Atomically creates membership and consumes a valid, unused invite for the authenticated account email |
| `/api/groups/:groupId/membership` | `DELETE` | Leaves a group; owners cannot orphan their group |
| `/api/groups/:groupId/messages` | `GET` | Polls up to 50 member-only messages using the returned stable cursor |
| `/api/groups/:groupId/messages` | `POST` | Stores up to 1,000 characters as plain text, with retry deduplication |

Nearby-event responses never contain coordinates, precise distances, owner identity, or private location data. Query and event locations are reduced to a fixed coarse grid for radius checks, and responses expose only broad distance bands. Invite redemption uses one transactional D1 batch: guarded membership creation and invite consumption either both succeed or both roll back, and both conditions reject expired parent groups. Message responses contain only the stable message ID, plain-text body, timestamp, and the sender’s member-safe display name; consumers must render `body` as text, never as HTML. Poll cursors use a persisted `INTEGER PRIMARY KEY AUTOINCREMENT` sequence separate from public opaque message IDs, so deleting retained messages cannot cause a cursor value to be reused. Polling is request/response only and may be performed every five seconds. Expired events, invites, messages, groups, idempotency records, and rate-limit rows are removed during authenticated API activity.

## Demo accounts

The reset endpoint creates two clearly labelled accounts using normal password hashes and sessions:

- `driver@demo.pudle.local` — **Demo Driver**
- `passenger@demo.pudle.local` — **Demo Passenger**

Set `DEMO_MODE=true`, `DEMO_RESET_SECRET`, `DEMO_DRIVER_PASSWORD`, and `DEMO_PASSENGER_PASSWORD`, then send a same-origin `POST /api/demo/reset` with `X-Pudle-CSRF: 1` and the reset secret in `X-Demo-Reset-Secret`. Passwords are runtime configuration and are not committed. Outside explicit demo mode the endpoint returns 404.

## 60–90 second demo

1. Open the public pitch at `/`, then use **Open Pudle** to enter `/app`. Open `/app` in two private browser contexts and sign in as the configured Driver and Passenger accounts. Reload once to show that each secure server identity persists independently.
2. On Driver, enable the camera, record a short clip, stop and save it, then open Recordings to play and export the device-local video. Point out that only its metadata syncs.
3. In Drive, tap **Share approximate location**, choose an observable road condition, review the rounded-location disclosure, and confirm the report. Show it in Passenger’s nearby feed, acknowledge it, then resolve it from Driver.
4. In Ride, have Driver create an email-bound Passenger invite. Redeem it in Passenger, send a short message, and show it arrive through persisted polling.
5. Tap **Enable voice**, say “Hey Pudy, what is displayed?”, then ask Pudy to prepare a hazard report. Show that recognition pauses while Pudy speaks and that report review opens but cannot share without confirmation. Foreground wake listening requires a visible, unlocked page; use text if speech recognition is unavailable.
6. Open Privacy and sign out. Explain that sign-out stops media, revokes playback URLs, closes account-scoped storage, and prevents another account from seeing the clips.

Without `GEMINI_API_KEY`, keep the cloud status visibly **Unconfigured** during the demo. If a credential is later supplied, disclose the provider terms before enabling periodic compressed-frame analysis; never imply that recordings or audio are uploaded.

Automated Pudy component tests use controlled mock browser speech-recognition and synthesis objects to verify cancellation, stale-response suppression, synchronous start errors, and rejected actions. They are not evidence that a physical microphone or a specific browser vendor’s speech service works on a target phone; verify that separately on the presentation device.

A compact release overview and presentation flow live in [`docs/SUBMISSION.md`](docs/SUBMISSION.md). It describes the product as implemented and does not assume any challenge-specific rules.

## Project structure

- `app/` contains the Vinext UI and server routes.
- `server/` contains validation, cryptography, session, authorization, rate-limit, and retention helpers.
- `db/schema.ts` defines the D1 schema.
- `drizzle/` contains generated migrations.
- `tests/` contains dependency-seamed Node tests that do not require live D1 or secrets.
- `docs/` distinguishes current behavior from roadmap capabilities.

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Stack

Vinext, React, TypeScript, Cloudflare D1, Drizzle ORM, Web Crypto, TensorFlow.js, and COCO-SSD.
