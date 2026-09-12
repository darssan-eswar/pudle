# Pudle Copilot instructions

Pudle (Peer Updated Driving Logic Engine) is a privacy-first road-intelligence product with the Pudy voice companion. Preserve these invariants in every generated change:

- Full recordings and raw audio never leave the browser. Periodic compressed frames may leave only after a separate explicit cloud-analysis opt-in with clear disclosure and independently controlled recording/cloud settings.
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

- `app/page.tsx`: mobile camera, local object detection, reporting, nearby alerts, and voice-query interface.
- `app/api/events/route.ts`: validated event creation and two-mile nearby-event queries.
- `app/globals.css`: responsive application styles.
- `db/`: Cloudflare D1 access and Drizzle schema.
- `drizzle/`: generated SQLite migrations and metadata.
- `public/`: installable-site and social assets.
- `docs/ROADMAP.md`: staged product scope; roadmap items are not implemented behavior.

The runtime is Vinext with React and TypeScript. Cloudflare D1 stores account and short-lived product metadata, never recording media. TensorFlow.js and COCO-SSD run in the browser; optional cloud analysis is a later slice.

## Development and database workflow

Use Node.js 22.13 or newer.

```bash
npm ci
npm run dev
npm run db:generate
```

`db/schema.ts` is the source of truth for database shape. After an intentional schema change, run `npm run db:generate` and review the generated migration before committing it. Never commit local Wrangler state or database contents.

## Required validation

Run the narrowest relevant checks while iterating, then run all available repository checks before completing substantive work:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Add focused tests for testable logic and behavior changes rather than relying only on manual verification.

## Definition of done

- Product behavior matches the task and preserves every privacy invariant above.
- New API inputs have explicit validation, bounded payloads, and minimal responses.
- Mobile controls remain accessible, driver-safe, and usable when optional inference fails.
- Relevant documentation and generated migrations are updated.
- Lint, TypeScript, available tests, and the production build pass.
- The change contains no secrets, private location data, generated database state, or unrelated edits.
