# Local setup

Run commands from the repository root with Node.js 22.13 or newer. The local database uses the same migrations as the hosted backend, but a separate persistence directory.

## Start a fresh instance

```bash
npm ci

export PUDLE_LOCAL_STATE_PATH="$PWD/.pudle-local/demo-$(date +%Y%m%d-%H%M%S)"
export APP_ORIGIN=http://localhost:4173
export DEMO_MODE=false

npm run db:migrate:local -- --persist-to "$PUDLE_LOCAL_STATE_PATH"
npm run dev -- --host 127.0.0.1 --port 4173
```

Open [the landing page](http://localhost:4173) and follow **Open Pudle** to `/app`. Create a local Pudle account or use the optional demo setup below.

Export runtime values in the shell that starts the server. `vite.config.ts` passes the listed server variables to the local Worker. Merely copying `.env.example` does not replace this step.

The D1 binding is named `DB`. The placeholder database ID in `wrangler.local.jsonc` is for local use; it is not the hosted database ID. Do not add `--remote` to local demo commands.

## Optional two-account demo

Stop the local server before changing its runtime values. In that same terminal, set:

```bash
export DEMO_MODE=true
export DEMO_RESET_SECRET='replace-with-a-unique-local-reset-secret'
export DEMO_DRIVER_PASSWORD='replace-with-a-unique-driver-password'
export DEMO_PASSENGER_PASSWORD='replace-with-a-unique-passenger-password'

npm run dev -- --host 127.0.0.1 --port 4173
```

In a second terminal, set `DEMO_RESET_SECRET` to the same local value before seeding:

```bash
export DEMO_RESET_SECRET='replace-with-the-same-local-reset-secret'

curl --fail-with-body -X POST http://localhost:4173/api/demo/reset \
  -H 'Origin: http://localhost:4173' \
  -H 'X-Pudle-CSRF: 1' \
  -H "X-Demo-Reset-Secret: $DEMO_RESET_SECRET"
```

This seeds `driver@demo.pudle.local` and `passenger@demo.pudle.local` using the configured passwords and normal password hashes. Use separate browser profiles to keep their sessions independent.

Only use this route against a fresh, isolated local database. It resets the demo accounts; it is not a production maintenance command. With `DEMO_MODE=false`, the reset route returns 404.

Demo mode adds **Use demo area**, a fixed, labeled coarse location shared by both accounts. It does not request device GPS. Real approximate-location sharing remains a separate opt-in.

## Optional cloud analysis

Set `GEMINI_API_KEY` only in the server environment and restart the local server. `GEMINI_MODEL` can override the model configured in [the provider contracts](../src/server/analysis/contracts.ts). Confirm the selected model is available to the provider account before testing it.

Without a key, the app shows **Unconfigured** and the analysis route returns `provider_unconfigured`. Recording, reports, ride messages, and Pudy text commands remain available.

Read [the privacy guide](PRIVACY.md) before sending frames. Start provider checks with non-sensitive synthetic images. Never put keys in `NEXT_PUBLIC_*` variables, browser code, issues, or commits.

## Environment reference

| Variable | Purpose |
|---|---|
| `APP_ORIGIN` | Exact browser origin accepted for mutations; match scheme, hostname, and port |
| `PUDLE_LOCAL_STATE_PATH` | Isolated local Miniflare/D1 state directory |
| `DEMO_MODE` | Enables local demo controls only when `true` |
| `DEMO_RESET_SECRET` | Required secret for the local reset endpoint |
| `DEMO_DRIVER_PASSWORD`, `DEMO_PASSENGER_PASSWORD` | Passwords used when seeding the two demo accounts |
| `GEMINI_API_KEY` | Optional server-only provider credential |
| `GEMINI_MODEL` | Optional provider model override |

[.env.example](../.env.example) lists the configuration keys. Keep real values out of Git.

## Database changes

Edit `src/db/schema.ts`, generate the migration, and review the SQL before applying it:

```bash
npm run db:generate
npm run db:migrate:local -- --persist-to "$PUDLE_LOCAL_STATE_PATH"
```

Test against an isolated database first. The current production database is managed through Sites; publish its reviewed migrations through that project's release process, not a guessed Wrangler database name.

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:landing
git diff --check
```

The build creates the Worker in `dist/server`. The landing export creates ignored static files under `deploy/vercel/public` from the same landing component.

If a browser API is unavailable, use the app's error message and fallback controls. Do not disable permission checks or replace failures with fake results. The [demo guide](SUBMISSION.md) separates the recorded flow from device and provider checks.
