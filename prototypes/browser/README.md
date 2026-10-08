# Earlier browser prototype

This folder contains the original Vinext / Cloudflare application, local-model experiments, scripts, tests, static assets, SQLite migrations and build configuration. It is separate from the current native iPhone app and live Next.js website.

For the current submission start with the [main README](../../README.md), [native iPhone app](../../apps/mobile/ios/README.md), or [live web app](../../deploy/vercel/README.md).

Root npm commands delegate to this package to preserve existing CI and development entry points. Install dependencies with `npm ci` at the repository root, then use the existing root commands such as `npm run typecheck`, `npm test` and `npm run build`. The production Vercel project still builds `deploy/vercel`.

The browser application's environment example is now `.env.example` in this folder; local environment files belong here and remain ignored. Older guides may show paths relative to the previous repository root: interpret `src/`, `scripts/`, `tests/`, `public/`, `drizzle/` and the browser config files relative to this folder. Cloudflare hosting metadata is kept in this folder under `.openai/`.
