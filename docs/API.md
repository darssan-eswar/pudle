# API reference

These routes run in the Pudle Worker. All user and membership checks happen on the server. The hosted site's outer access gate is separate from the Pudle session described below.

[Local setup](SETUP.md) · [Privacy](PRIVACY.md) · [Deployment](DEPLOYMENT.md)

## Authentication API

JSON mutation requests require:

- `Content-Type: application/json` when a body is present
- an `Origin` matching `APP_ORIGIN` (or the request origin when unset)
- `X-Pudle-CSRF: 1`

The cloud-analysis route uses a raw image body and its own content types, described below. The same Origin and CSRF checks still apply.

Passwords use PBKDF2-SHA-256 hashes. Production sessions use rotating opaque tokens in `Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-` cookies. Loopback HTTP previews use a separate local-only cookie name.

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
- actual body no larger than 512 KiB (`Content-Length`, when supplied, is only an early rejection hint)
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

Nearby-event responses never contain coordinates, precise distances, owner identity, or private location data. Query and event locations are reduced to a fixed coarse grid for radius checks, and responses expose only broad distance bands. Invite redemption uses one transactional D1 batch: guarded membership creation and invite consumption either both succeed or both roll back, and both conditions reject expired parent groups. Message responses contain only the stable message ID, plain-text body, timestamp, and the sender’s member-safe display name; consumers must render `body` as text, never as HTML. Poll cursors use a persisted `INTEGER PRIMARY KEY AUTOINCREMENT` sequence separate from public opaque message IDs, so deleting retained messages cannot cause a cursor value to be reused. The app polls nearby events and ride messages about every four seconds while active; it does not use WebSockets. Expired events, invites, messages, groups, idempotency records, and rate-limit rows are removed during authenticated API activity.
