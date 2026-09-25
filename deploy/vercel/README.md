# Pudle convoy app on Vercel

This is the focused, public-facing Next.js app for the road-obstacle demo.
Vercel serves the landing page and app. Supabase provides email accounts,
convoy membership, short-lived reports, and Realtime delivery. The app uses a
publishable key and Row Level Security; it does not use a service-role key in
the browser.

The older Vinext/Cloudflare prototype remains in `../../src/`. It is a separate,
owner-private deployment and is not the backend for this app.

## Local checks

From this directory:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Set the two keys in `.env.local` using `.env.example`. The project URL and
publishable key are public configuration; do not add a Supabase secret key or
database password to a `NEXT_PUBLIC_` variable. Until these keys are set, `/app`
shows a setup message.

## Database

Apply `../../supabase/migrations/202609250001_convoy_obstacles.sql` to a dedicated
Supabase project. It creates the tables, membership functions, policies, and
Realtime publication. Do not use an existing production project until its schema
and policies have been reviewed. See [soft-launch guide](../../docs/OBSTACLE_SOFT_LAUNCH.md).

## Vercel

Link this directory to the existing `pudle` project under
`darssan-eswars-projects`. Connect the free Supabase integration or enter the
project URL and publishable key as production and preview environment variables.
Then build and deploy from this directory:

```bash
vercel link --yes --scope darssan-eswars-projects --project pudle
vercel --prod --scope darssan-eswars-projects
```

`vercel.json` selects the Next.js framework. It no longer forwards `/app` to
the owner-private Cloudflare worker. If you use Git integration later, set the
Vercel root directory to `deploy/vercel`.
