# Data handling and privacy

This describes the current implementation, not a guarantee about browser vendors, model providers, or hosting operators.

## What stays on the device

Recording files, playback, and exports use browser storage. The server's recording API accepts JSON metadata, not media bytes. Each account uses a separate local recording store.

Signing out stops active media and closes the account's storage access; it does not erase saved clips from the device. Browser storage can be cleared or evicted. Export anything that must be kept.

Optional object detection runs on the device. Pudle does not identify faces, read plates, identify vehicle owners, or infer intoxication, intent, or culpability.

## What reaches the backend

| Data | Handling |
|---|---|
| Accounts and sessions | Server-verified identity; password hashes and opaque session tokens |
| Recording metadata | Visible only to the owning account; unavailable through the app after 24 hours |
| Road reports | Confirmed by the user; rounded coordinates; nearby responses omit coordinates and reporter identity |
| Ride invitations and messages | Restricted to authorized owners, invitees, and members |
| Analysis jobs and results | Per-user metadata; unavailable through the app after 30 minutes |

Nearby reports cover up to two miles and expire after 30 minutes. Ride groups are short-lived, with a 24-hour lifetime.

Expired records are excluded from app reads. Physical database cleanup happens during relevant API requests, not at a guaranteed wall-clock deadline. This deployment has no scheduled cleanup handler. Hosting backup retention is controlled by the hosting operator.

## Microphone and Pudy

Voice starts only after **Enable voice**. The browser's speech service may process microphone audio outside the device. This is separate from recording audio and separate from Gemini frame analysis.

Pudy pauses recognition while replying and while the page is hidden. Stop, sign-out, session expiry, and leaving the app stop the listening session. Text controls remain available. There is no background or locked-phone listening guarantee.

## Optional cloud frames

Cloud analysis requires separate consent. Each request accepts one JPEG or WebP still, not video, recording audio, or an entire clip.

- Maximum request size: 512 KiB.
- Maximum image dimension: 1920 pixels.
- Minimum interval: five seconds per user.
- One in-flight analysis per user.
- Rate limits: 12 requests per user per minute and 30 per IP per minute.
- Provider timeout: eight seconds per attempt, with one bounded retry for transient failures.

Pudle uses frame bytes in memory during the request and provider call; it does not persist them in D1 or application logs. Analysis records contain validated observation categories and confidence, not the frame or the provider's raw response.

Summary and uncertainty text are generated from validated categories. Invalid provider output is rejected. This is not an identity-recognition or safety-certification system.

## Provider handling

When configured, the Worker sends consented frames to Google Gemini. Pudle's own storage rules do not control Google's retention or processing.

As checked on September 14, 2026, Google's terms distinguish paid and unpaid services. Unpaid-service content may be used for product improvement and human review. Paid-service prompts and responses are not used for product improvement, but limited abuse-monitoring retention still applies. Account and regional conditions matter. Read the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) before enabling analysis; do not submit sensitive material to unpaid services.

No provider credential is configured in the current deployment. The app reports **Unconfigured**, and no live provider request has been verified.

## Release checks

Before widening access, test account isolation, membership checks, retention, sign-out cleanup, and the final public origin. Do not put private-site bypass credentials in the public Vercel gateway.

See [API contracts](API.md) for request validation and [verification](VERIFIED.md) for the evidence and remaining device checks.
