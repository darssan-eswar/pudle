# Vercel landing and app entry

This directory serves the public landing page and forwards app/API requests to the existing Pudle Worker. It does not contain a database or private recordings.

[Current deployment and access status](../../docs/DEPLOYMENT.md)

## Build from the repository root

```bash
npm ci
npm run build
npm run build:landing
```

The export reuses `app/page.tsx` and the production stylesheet. It writes static HTML, CSS, and icons under `public/`. Those generated files are ignored by Git and included in the Vercel upload through `.vercelignore`.

## Publish

After verifying the source revision and build:

```bash
cd deploy/vercel
vercel link --project pudle --scope darssan-eswars-projects
vercel deploy --prod --scope darssan-eswars-projects
```

Run the CLI from this directory, not the repository root. The root build targets a Cloudflare Worker; it is not a standard Next.js Vercel deployment.

The current public address is [pudle-demo.vercel.app](https://pudle-demo.vercel.app). If it changes, update the canonical URL in `scripts/build-landing.ts` and the backend's trusted origin.

## Routing and secrets

- `/` and the landing assets are static.
- `/app`, `/api`, and `/_next` forward to the existing Worker.
- API responses and external rewrites are not cached.
- The backend audience is managed in Sites. Publishing this directory does not make the private app public.
- Keep provider credentials in the Worker runtime. Never put them in this directory or in client-prefixed environment variables.

Deploy a matching Worker revision before an application release. Follow the [deployment checklist](../../docs/DEPLOYMENT.md) for access, origin, database, and two-user checks.

Reference: [Vercel rewrites](https://vercel.com/docs/routing/rewrites).
