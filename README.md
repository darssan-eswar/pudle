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
npm install
npm run dev
```

Open `http://localhost:3000`. Camera and location access require user permission. The app continues in a safe demo mode if either permission is declined.

## Validate

```bash
npm run db:generate
npm run lint
npm run build
```

## Stack

- Vinext / React / TypeScript
- TensorFlow.js and COCO-SSD for browser-side inference
- Cloudflare D1 for short-lived metadata
- Web Speech APIs for the MVP voice interface
- GitHub Copilot project instructions in `.github/copilot-instructions.md`

See [docs/ROADMAP.md](docs/ROADMAP.md) for the product stages and contest demo script.
