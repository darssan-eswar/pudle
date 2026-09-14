# Vercel entry point

This directory deploys a Vercel reverse proxy for the existing Pudle Worker. The Worker serves the landing page at `/`, the app at `/app`, and the authenticated API at `/api`. D1 remains attached to the Worker; the Vercel deployment does not contain a second database or copies of private media.

Deploy this directory, not the repository root. The root build targets Cloudflare Workers and cannot be treated as a standard Next.js Vercel build.

Before public release:

1. Deploy the matching repository revision through the existing Sites project and verify its migrations.
2. Confirm the owner authorizes public access to the hosted app. Keep application authentication enabled.
3. Set the Worker's `APP_ORIGIN` to the exact assigned public HTTPS Vercel origin. Do not trust arbitrary forwarded host headers or wildcard origins.
4. Keep `DEMO_MODE=false` in the public environment. Configure `GEMINI_API_KEY` as a Worker secret for live cloud analysis; it must not be placed in this directory or browser code.
5. Verify sign-up, cookie session restoration, two-account isolation, reports, messages, and opt-in analysis through the Vercel address. Keep API and authenticated responses uncached.

Vercel may assign a fallback hostname if `pudle.vercel.app` is already in use. Use the hostname returned by the actual deployment. A production alias is not proof of a functioning upstream deployment.

Reference: https://vercel.com/docs/routing/rewrites
