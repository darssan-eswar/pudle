# Pulzar

Pulzar turns a phone into a privacy-first road-intelligence node. The camera is processed in the browser, video never reaches the server, and only anonymous, coarse-location metadata is shared with drivers within two miles.

## Working MVP

- Live rear-camera capture on mobile browsers
- On-device TensorFlow.js / COCO-SSD object detection
- Anonymous road-hazard, reckless-driving, crash, and flooding reports
- Live two-mile event feed backed by Cloudflare D1
- 30-minute automatic event expiration
- Coordinates rounded to roughly 110-meter precision before transmission
- Voice query and spoken nearby-road summary using browser speech APIs
- San Francisco demo mode when location access is unavailable

The current web transport is HTTPS. The same compact event envelope is intended to be bridged to Pulzar LoRaWAN gateways as the hardware network comes online.

## Privacy model

Pulzar does not upload camera frames, retain video, detect license plates, identify drivers, or store a user account. A shared event contains only an event category, approximate coordinates, confidence/source labels, and creation/expiration times. Nearby-event responses omit event coordinates and return distance only.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Camera and location access require user permission. The app continues in a safe demo mode if either permission is declined.

## Project structure

- `app/` contains the Vinext UI and server routes.
- `app/api/events/route.ts` validates reports and serves fresh events within two miles.
- `db/` contains the D1 access layer and Drizzle schema.
- `drizzle/` contains generated migrations; do not edit generated metadata by hand.
- `docs/` contains product scope and roadmap documentation.

When `db/schema.ts` changes, run `npm run db:generate` and review the generated migration. Local D1 and Wrangler state is ignored and must not be committed.

## Validate

```bash
npm run db:generate
npm run lint
npm run typecheck
npm run test --if-present
npm run build
```

The repository does not yet define an automated test script. CI runs tests automatically once a `test` script is added.

## Stack

- Vinext / React / TypeScript
- TensorFlow.js and COCO-SSD for browser-side inference
- Cloudflare D1 for short-lived metadata
- Web Speech APIs for the MVP voice interface
- GitHub Copilot project instructions in `.github/copilot-instructions.md`
- Scoped Copilot agents and reusable prompts in `.github/agents/` and `.github/prompts/`

See [docs/ROADMAP.md](docs/ROADMAP.md) for the product stages and contest demo script.
