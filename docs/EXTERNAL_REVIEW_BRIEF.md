# Pudle review brief

Updated October 1, 2026. This is a handoff for an independent product and
engineering review, not a claim that the road demo is ready for driving.

## Decision to review

Is a narrow, person-confirmed obstacle report useful and credible as a first
Pudle demonstration? The proposed scene is a passenger in the lead car reporting
a tree or branch; a following phone in the same private convoy receives a visual
and spoken report. Both phones need connectivity. Nobody should operate the app
while driving.

Please assess the actual implementation against that scene, identify the
smallest set of release blockers, and separate those from future ideas. In
particular, challenge the assumption that a report belongs to a following
vehicle: the app knows convoy membership, not car order, lane, distance, or
whether the listener will encounter the obstacle.

## What is in this repository

| Area | Status |
| --- | --- |
| `deploy/vercel/` | Next.js landing and two-account convoy UI; local tests, typecheck, and build pass. |
| `supabase/` | Migration for Auth-backed convoy membership, short-lived reports, RLS, and Realtime; SQL policy tests are present. |
| `src/` | Older owner-private Vinext/Cloudflare prototype with dashcam, ride, voice, cloud-analysis, and local-model experiments. It is not the backend for the Next.js app. |
| `research/` | Candidate-model notes and a benchmark proposal. Synthetic fixtures do not establish road-scene accuracy. |

The current demo is *manual*: the lead passenger chooses a category and
confirms before sharing. The report contains no photo, video, location, lane,
or distance. The following phone speaks a fixed phrase only after its user
enables audio and while browser audio is available. Reports are visible for two
minutes; a three-second refresh complements Realtime. See
[`OBSTACLE_SOFT_LAUNCH.md`](OBSTACLE_SOFT_LAUNCH.md) for the exact flow and
privacy boundary.

## Deployment state

The existing Vercel project `darssan-eswars-projects/pudle` is connected to
`darssan-eswar/pudle`. Its framework is Next.js and its root directory is
`deploy/vercel`. A local production build passed on September 30. These
settings do not prove a successful hosted release.

As checked October 1, the Vercel Production environment had **no** project
variables. The app requires `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; without them, `/app` intentionally
shows a setup message. A dedicated Supabase project still needs the migration,
Auth redirect URLs, and a tested email provider. Do not place a service-role
key or database password in a `NEXT_PUBLIC_` variable.

The September 14 production deployment was the older landing/gateway. A new
Git-connected build and a two-device end-to-end test must be checked before
calling the Supabase app live. The Git connection may initiate a build before
the Supabase setup is complete; build success alone is not demo readiness.

## Evidence and limits

- `cd deploy/vercel && npm test && npm run typecheck && npm run build` passed on
  September 30: three focused report tests and a static Next.js build.
- The newer Supabase app has **not** been tested with two real accounts on two
  phones. No measured report latency, delivery reliability, or audio success
  rate exists yet.
- Browser speech may stop when a tab is hidden or a phone is locked. There is
  no native wake word, background alert, Bluetooth mesh, automatic tree
  detection, or live Gemini analysis in this release.
- A two-minute visibility filter is not physical deletion. Retention cleanup
  must be implemented and tested before a wider pilot.
- Older prototype test results in [`VERIFIED.md`](VERIFIED.md) apply to `src/`,
  not to the new Supabase two-phone path.
- Two older Copilot branches, `darssan-eswar-events-rides-api` and
  `darssan-eswar-pudle-app-integration`, remain outside `main`. They modify
  the prototype and should be reviewed and tested before any merge; they are
  not required for the obstacle-only release.

## Requested review output

1. Verdict on the person-confirmed, connectivity-dependent obstacle demo as a
   challenge submission and as a limited soft launch; state which claims are
   supportable today.
2. Ranked release blockers with concrete acceptance tests, especially Supabase
   RLS isolation, email confirmation, foreground speech, duplicate/stale
   reports, and two-phone delivery timing.
3. A safer on-screen and spoken message that does not imply verified position,
   proximity, or collision avoidance.
4. The smallest follow-on architecture for real camera detection and phone
   performance evaluation, without treating model research as a shipped feature.

Review the code and migration, not only this brief. Avoid assuming the GitHub
challenge rules, a contest deadline, or hardware capabilities that have not
been provided and verified.
