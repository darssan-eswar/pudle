# Deployment

Status checked September 14, 2026.

## Addresses and access

| Surface | Address | Access |
|---|---|---|
| Landing | [pudle-demo.vercel.app](https://pudle-demo.vercel.app) | Public |
| App entry | [pudle-demo.vercel.app/app](https://pudle-demo.vercel.app/app) | Reaches the existing protected backend |
| Backend app | [Hosted Pudle app](https://pulzar-road-intelligence.ledarssan919276.chatgpt.site/app) | Owner-only ChatGPT access, then Pudle account sign-in |
| Source | [darssan-eswar/pudle](https://github.com/darssan-eswar/pudle) | Private repository |

The old `pulzar-road-intelligence` hostname is the existing backend address. Its display name is Pudle. Renaming the product did not rename that hostname.

### Why not pudle.vercel.app?

Vercel rejected the exact address with **“The chosen alias pudle.vercel.app is already in use.”** The app build was not the cause. The error establishes an alias conflict, not who owns the address.

The current project has `pudle-demo.vercel.app` and the automatically assigned `pudle-phi.vercel.app`. Use the demo address consistently. Do not delete an unrelated deployment or remove somebody else's alias to obtain the shorter name. [Vercel's alias guidance](https://vercel.com/kb/guide/how-to-resolve-alias-errors-on-vercel)

## Hosting layout

Vercel serves the static landing page. Requests for `/app`, `/api`, and `/_next` are forwarded to the existing Cloudflare Worker. D1 stays attached to that Worker; there is no separate Vercel database.

The public landing is rendered from `app/page.tsx` without app account data or client JavaScript. The full app still runs on the Worker. API responses are marked private and non-cacheable, and rewrite caching is disabled.

Configuration: [Vercel gateway](../deploy/vercel/vercel.json), [landing export](../scripts/build-landing.ts), [Sites project](../.openai/hosting.json).

## Published application release

- Application source: `3e543e9a8bb2af4ef1cb779c08d81510b74d918d`.
- GitHub merge: [PR #1](https://github.com/darssan-eswar/pudle/pull/1), merge commit `8f3a8bd12b385eb28f03744eaec606b5b526b74b`.
- Backend: Sites version 3, deployed successfully with environment revision 1.
- Database: account, session, recording metadata, road report, ride membership, message, analysis, rate-limit, and idempotency tables are present.
- Vercel landing: desktop and 390px phone-width checks passed.
- Production demo reset is disabled. No live cloud-provider request has been verified.

Documentation-only commits after this release do not imply a new application deployment. [Verification details](VERIFIED.md)

## Runtime configuration

The current backend has:

| Key | Value |
|---|---|
| `APP_ORIGIN` | `https://pulzar-road-intelligence.ledarssan919276.chatgpt.site` |
| `DEMO_MODE` | `false` |
| `GEMINI_API_KEY` | Not configured |

Store hosted runtime values in Sites, not in the hosting manifest or Vercel's static output. A provider key must be a backend secret.

The outer ChatGPT access gate and Pudle's session cookies are different controls. Public landing access does not remove either one. Do not use a private-site bypass credential in the public gateway.

## Application release procedure

1. Work from current GitHub `main`. Open a focused PR and let CI finish before merging.
2. Build the chosen source revision and review any database migrations. Keep local demo state and credentials out of the release.
3. For backend changes, use the existing Sites project. Push the exact source revision to its configured source branch, save that revision's build as a version, then deploy it without changing the audience.
4. Wait for the backend deployment to succeed. Confirm the expected database schema and runtime configuration.
5. Build and publish the static landing/gateway from [deploy/vercel](../deploy/vercel/README.md). Do not deploy the repository root as a standard Next.js Vercel project.
6. Check the real landing, app entry, sign-in, and API behavior. Record the source revision, URLs, test results, and unverified integrations in the PR.

A merge to GitHub is not itself a backend deployment. The current Vercel release was also deployed through the CLI; an automatic Git-to-Vercel release is not configured here.

For documentation-only changes, run the documentation checks and normal PR workflow. No database migration or application redeployment is needed.

## Before a public app demo

- Get the owner's explicit approval to change the existing backend audience.
- Keep Pudle's own authentication and per-user authorization enabled.
- Set `APP_ORIGIN` to `https://pudle-demo.vercel.app` and redeploy the saved backend version to apply it.
- Verify signup, cookie restoration, sign-out, two-user isolation, reports, and ride messages through the Vercel address.
- Keep `DEMO_MODE=false` and local reset credentials out of production.
- Configure an approved provider secret, review its data terms, and run a consented synthetic-frame check.
- Check physical camera, microphone, and speech output on the presentation phone.

If the public address changes, update the static canonical URL and the backend's trusted origin together. Do not accept wildcard or visitor-supplied origins.
