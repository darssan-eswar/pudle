# Pudle

Pudle helps people traveling together share a road observation. The current
soft-launch target is deliberately narrow: a passenger in the lead car confirms
an obstacle, and the following phone displays and speaks the report.

[Landing page](https://pudle-demo.vercel.app) · [App](https://pudle-demo.vercel.app/app) · [Two-phone demo guide](docs/OBSTACLE_SOFT_LAUNCH.md) · [Research](research/README.md)

For an independent assessment, start with the [review brief](docs/EXTERNAL_REVIEW_BRIEF.md).

## Current architecture

| Part | Where | Job |
|---|---|---|
| `deploy/vercel/` | Vercel | Next.js landing, signup, convoy and report interface |
| `supabase/` | Supabase | Auth, Postgres tables, Row Level Security, Realtime |
| `src/` | Owner-private Sites/Cloudflare prototype | Earlier dashcam, rides, Pudy, D1, and model experiments |

The Vercel app is replacing the old landing gateway, which forwarded `/app` to
the owner-private prototype. These are separate applications and databases.
The older prototype is still useful for dashcam and model research, but its
private access gate prevents a second person from signing up through the public
URL. The Supabase app is the two-person demo path after database provisioning,
migration, deployment, and phone verification are complete.

## What the obstacle demo implements

- Two independent email accounts and a private convoy joined by a short code.
- A confirmed report for a tree or branch, debris, stopped vehicle, or other obstruction.
- Supabase Realtime delivery with a three-second refresh path when Realtime misses a message.
- A visual alert and optional spoken report on the following phone after the listener enables audio.
- Short report visibility: two minutes. The convoy expires after 24 hours.

The report carries no image, coordinates, lane, or distance. Automatic camera
detection and background voice are not part of this release. [Read the demo and
device checklist](docs/OBSTACLE_SOFT_LAUNCH.md) before recording a driving
demonstration.

## Run the Vercel app locally

Use Node.js 22.13 or newer. Configure a Supabase project with
[the migration](supabase/migrations/202609250001_convoy_obstacles.sql), and set
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
`deploy/vercel/.env.local`.

```bash
cd deploy/vercel
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The previous prototype is built separately from the repository root. Its
[local setup](docs/SETUP.md), [API](docs/API.md), [privacy notes](docs/PRIVACY.md),
and [model verification](docs/VERIFIED.md) describe that application. It uses
Vinext, Cloudflare D1, COCO-SSD, and a pinned local SmolVLM prototype; the
focused Vercel app does not claim those functions.

## Research and next stages

[Pudle-Edge research](research/README.md) contains the abstract,
[candidate models](research/MODELS.md), [benchmark proposal](research/BENCHMARK.md),
and [roadmap](research/ROADMAP.md). The benchmark fixture is synthetic and does
not establish accuracy on road footage or a phone. Native “Hey Pudy,” automatic
tree detection, Bluetooth relay, vehicle integration, and a larger convoy trial
remain research and engineering work.

The repository is private. No open-source license or challenge deadline is
assumed. Do not commit credentials or private driving media.
