# Pudle

Pudle turns a phone into a private dashcam. Save clips on the device, share a confirmed road report, and message the people in your ride. Pudy is the voice companion: enable voice, then say “Hey Pudy.”

[Landing page](https://pudle-demo.vercel.app) · [App](https://pudle-demo.vercel.app/app) · [Setup](docs/SETUP.md) · [Demo guide](docs/SUBMISSION.md)

## Release status

The landing page is public. The app and backend are deployed, but the existing owner-only ChatGPT access gate remains in place before Pudle's own account sign-in. The repository is private.

Cloud analysis has no provider credential configured. “Hey Pudy” works through supported browser speech APIs while the page is visible; it is not a background or locked-phone wake-word service. Camera and microphone behavior still need a check on the presentation phone.

See [deployment status and release gates](docs/DEPLOYMENT.md) for the current URLs and configuration.

## What the MVP does

- Records the camera locally, with playback, export, and deletion. Only recording metadata syncs to the backend.
- Keeps accounts, sessions, and recording metadata separate for each user.
- Shares confirmed road reports within two miles for up to 30 minutes. Responses omit reporter identity and coordinates.
- Supports invite-only rides with email-bound invitations and persisted text messages.
- Lets Pudy answer from displayed observations, save a clip, stop recording, or prepare a report. Sharing still requires confirmation.
- Offers optional on-device object detection and a separately consented cloud-analysis path for compressed still frames.
- Runs local model work through a single-flight scheduler with explicit capability, loading, ready, and error states.

Reports and model output can be wrong. Pudle is not a navigation system or a safety guarantee. Use the demo while parked or as a passenger.

## Run locally

Use Node.js 22.13 or newer, then install the locked dependencies:

```bash
npm ci
```

Follow [local setup](docs/SETUP.md) to create an isolated database, start the app, and optionally seed two demo accounts. No provider key is needed for recording, reports, ride messages, or text controls.

## Architecture

| Component | Responsibility |
|---|---|
| `src/` | Vinext routes, React components, browser libraries, server services, D1 schema, and application styles |
| Browser | Camera, local clips, optional on-device detection, Pudy voice/text controls |
| Vercel | Static landing page; forwards app and API requests to the Worker |
| Cloudflare Worker and D1, hosted through Sites | Authentication, per-user metadata, reports, rides, messages, and optional analysis requests |
| Google Gemini, when configured | Processes separately consented compressed still frames |

There is one backend database. Vercel does not hold a second copy of it, and the server does not store recording files. [Data handling and retention](docs/PRIVACY.md)

The app uses Vinext, React, TypeScript, Drizzle, Web Crypto, TensorFlow.js, and COCO-SSD. Pudy's current commands do not require a language-model API.

## Documentation

| Guide | Contents |
|---|---|
| [Setup](docs/SETUP.md) | Local database, environment variables, demo accounts, validation |
| [API](docs/API.md) | Routes, request headers, authentication, limits, and response behavior |
| [Deployment](docs/DEPLOYMENT.md) | Live addresses, hosting split, release process, remaining gates |
| [Privacy](docs/PRIVACY.md) | Recordings, location, microphone processing, cloud frames, retention |
| [Verification](docs/VERIFIED.md) | Test results, browser checks, and what has not been verified |
| [Local models](docs/LOCAL_MODELS.md) | Portable inference contract, COCO-SSD integration, evaluation limits |
| [Demo guide](docs/SUBMISSION.md) | Problem, solution, recording sequence, submission checklist |
| [Implementation status](docs/IMPLEMENTATION_PLAN.md) | Delivered work and unfinished release checks |
| [Roadmap](docs/ROADMAP.md) | Later ideas, clearly separate from the MVP |

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:landing
npm run evaluate:local-model
```

GitHub Actions runs these checks for pull requests and pushes to `main`. The local-model foundation passes 142 tests: 50 server tests and 92 client tests. See [verification evidence](docs/VERIFIED.md).

## Contributing and submission

Keep changes focused, add tests for changed behavior, and use a pull request with passing CI. Never commit credentials, local database state, or private media.

The exact GitHub challenge and its rules have not been confirmed. No contest deadline, public-repository requirement, or submission format is assumed. A license must be chosen by the owner before presenting this as an open-source release.
