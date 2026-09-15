# Pudle Copilot instructions

Pudle is a phone dashcam with local recordings, nearby reports, private ride messages, and the Pudy voice companion. Preserve these rules in every change:

- Full recordings and recording audio stay in the browser. Separately enabled foreground speech may use the browser vendor's microphone-processing service; disclose that distinction. Compressed frames may leave only after a separate cloud-analysis opt-in, independently controlled from recording.
- Do not add license-plate recognition, facial recognition, vehicle-owner identification, or persistent device tracking.
- Round report coordinates to three decimal places before network transmission.
- Nearby road events must be limited to a two-mile radius and expire after 30 minutes.
- Describe observable road behavior, never inferred intoxication, identity, intent, or culpability.
- Never expose server secrets in client components.
- Keep edge inference optional: camera and manual reporting must still work when an AI model fails to load.
- Use accessible buttons, visible permission states, mobile-first layouts, and concise driver-safe copy.
- Add a validation path for every new API input and return the minimum metadata needed by the interface.
- Treat LoRaWAN, MCP, vehicle integrations, parking inference, gas-price OCR, and signal timing as roadmap capabilities until their end-to-end implementation is verified.

Prefer small composable functions, explicit TypeScript types, and progressive enhancement over framework complexity.

## Repository map

- `src/app/page.tsx`: public landing page; preserve it when changing the authenticated app.
- `src/app/app/page.tsx` and `src/components/app/`: authenticated camera, recordings, reports, rides, privacy, and Pudy controls.
- `src/app/api/events/route.ts`: validated event creation and two-mile nearby-event queries.
- `src/app/api/analysis/` and `src/server/analysis/`: existing still-frame analysis API and server-only Gemini REST adapter.
- `src/app/globals.css`: responsive application styles.
- `src/db/`: Cloudflare D1 access and Drizzle schema.
- `drizzle/`: generated SQLite migrations and metadata.
- `public/`: installable-site and social assets.
- `scripts/build-landing.ts` and `deploy/vercel/`: static landing export and gateway to the Worker.
- `docs/SETUP.md`, `docs/API.md`, and `docs/DEPLOYMENT.md`: setup, contracts, and current hosting/access state.
- `docs/ROADMAP.md`: staged product scope; roadmap items are not implemented behavior.

The runtime is Vinext with React and TypeScript. Cloudflare D1 stores account and short-lived product metadata, never recording media. TensorFlow.js and COCO-SSD run in the browser. The optional cloud-analysis path is implemented but has not been verified with a live provider credential. Pudy's current voice/text commands are grounded in displayed data and do not call a language-model API. Do not add an `/api/ask` route or replace the provider adapter unless the task explicitly requires it.

## Development and database workflow

Use Node.js 22.13 or newer.

```bash
npm ci
```

Follow `docs/SETUP.md` to select isolated local state, apply local migrations, and start the server. Do not reset a shared database or enable demo reset in production.

`src/db/schema.ts` is the source of truth for database shape. After an intentional schema change, run `npm run db:generate` and review the generated migration before committing it. Never commit local Wrangler state or database contents.

## Required validation

Run the narrowest relevant checks while iterating, then run all available repository checks before completing substantive work:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:landing
```

Add focused tests for testable logic and behavior changes rather than relying only on manual verification.

## Definition of done

- Product behavior matches the task and preserves every privacy invariant above.
- New API inputs have explicit validation, bounded payloads, and minimal responses.
- Mobile controls remain accessible, driver-safe, and usable when optional inference fails.
- Relevant documentation and generated migrations are updated.
- Lint, TypeScript, available tests, and the production build pass.
- The change contains no secrets, private location data, generated database state, or unrelated edits.
- Deployment, public access, provider credentials, and physical-phone checks are reported separately from unit-test success. Do not claim a challenge deadline or submission requirement without its official rules.
