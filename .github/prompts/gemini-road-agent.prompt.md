---
name: gemini-road-agent
description: Verify and improve Pudle's existing opt-in still-frame analysis.
agent: privacy-backend
---

Work on the existing analysis flow, not a new conversational API. Read `docs/API.md`, `docs/PRIVACY.md`, `docs/DEPLOYMENT.md`, and the current `src/server/analysis/` code before changing it.

The browser submits one bounded JPEG or WebP still to `POST /api/analysis` after separate consent. The Worker verifies the session, origin, CSRF header, frame format and dimensions, timestamp, rate limit, and idempotency key. The existing server-only Gemini REST adapter returns observation categories and confidence; Pudle validates them and generates its own summary text.

Preserve those contracts. Do not introduce `/api/ask`, add a second provider SDK, upload recordings or audio, call Gemini from the browser, or turn Pudy's displayed-data commands into model calls unless the user's task explicitly asks for that change.

Keep `GEMINI_API_KEY` server-only. With no key, keep the clear `provider_unconfigured` response and disabled cloud state. Do not substitute a fixture as a live result. Automated tests may use synthetic frames and a stub provider.

For changed behavior, cover validation, consent, authentication, account isolation, cadence and concurrency, idempotent retry, timeout, malformed output, and untrusted text in images. Never log frames, credentials, coordinates, or provider payloads.

Only run live provider checks when the operator has configured an approved credential and authorized the test input. Report mocked, local, and live evidence separately. Update the API and privacy guides if the behavior changes.
