# Pudle

Pudle (**Peer Updated Driving Logic Engine**) is a privacy-first road-intelligence app with the Pudy voice companion. The current MVP provides a mobile local camera scanner, manual road reports, nearby alerts, and a secure authentication/persistence foundation.

## Current implementation

- Live rear-camera preview and optional on-device TensorFlow.js / COCO-SSD detection
- Manual and edge-assisted road-event metadata, rounded to three decimal places
- Authenticated D1-backed events limited to two miles and 30 minutes, with owner resolution and idempotent acknowledgements
- Invite-only, 24-hour demo ride groups and member-isolated plain-text messaging
- Email/password accounts with PBKDF2-SHA-256 password hashes
- Rotating opaque sessions in `Secure`, `HttpOnly`, `SameSite=Strict` cookies; only SHA-256 token hashes are stored
- D1 contracts for recording metadata, opt-in analysis metadata, event acknowledgement/resolution, invite-only groups, messages, idempotency, rate limits, and retention
- Pudy-labelled local demo query UI

Camera recording, cloud frame analysis, group/ride **UI integration**, and full Pudy voice behavior are planned but are **not implemented** in this slice. The group and messaging server APIs are available for the pending UI.

## Privacy model

Pudle never performs face recognition, license-plate recognition, vehicle-owner identification, persistent tracking of other users, or accusations about intoxication, intent, or culpability. Full recordings and raw audio remain local.

Future cloud analysis may receive only bounded periodic compressed frames after a separate explicit opt-in and disclosure. Recording and cloud analysis must remain independently controlled. D1 stores accounts and metadata, not media blobs. Nearby-event responses omit coordinates.

## Local setup

Use Node.js 22.13 or newer:

```bash
npm ci
npm run dev
```

Configure the Cloudflare D1 binding as `DB`. Copy `.env.example` values into the runtime’s server environment; never expose them through client-prefixed variables.

Apply generated migrations using the deployment environment’s Wrangler/D1 workflow. The schema source of truth is `db/schema.ts`; after changing it:

```bash
npm run db:generate
npx wrangler d1 migrations apply <DATABASE_NAME> --local
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
| `/api/demo/reset` | `POST` | Resets demo credentials only under the explicit demo gate |

Clients never provide a trusted user ID. Server routes derive identity from the session cookie. Email is trimmed/lowercased, names and passwords are bounded, and payloads are size/shape checked. Signup, sign-in, event creation, and enabled demo-reset attempts are rate-limited. Sign-out is deliberately not rate-limited so a client can always invalidate its session and clear its cookie.

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
