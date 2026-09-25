# Road-obstacle soft launch

September 25, 2026. Scope: one confirmed obstacle report from a lead vehicle
reaching a following vehicle in the same private convoy.

## What the demo does

Each person creates an email account through Supabase Auth. The first person
creates a convoy and shares its twelve-character code. The second person joins.
A passenger in the lead vehicle selects an obstacle and confirms a report.
Supabase saves a small metadata row and delivers it through Realtime. The
following phone shows the report and speaks a fixed message if audio was enabled
with a tap while the app is visible. A three-second refresh catches missed
Realtime messages. Reports are shown for two minutes; the convoy expires in
24 hours.

The report contains a category, convoy ID, reporter ID, and timestamps. It does
not contain video, a photograph, coordinates, a lane, or a distance estimate.
The spoken message does not claim where the obstacle is relative to the listener.
Browser speech can be silent when the phone locks, the tab is hidden, or the
platform suspends audio. This web demo has no background alert channel.

## Data path

```text
Lead phone → Supabase Auth → RLS-checked report insert → Postgres + Realtime
                                                   ↘ following phone display + speech
                                                        (3 s refresh fallback)
```

The Next.js app is hosted on Vercel. The browser uses the Supabase publishable
key with the signed-in user's token. Row Level Security restricts reads to
members of the convoy and inserts to that member's own ID. Convoy creation and
joining use narrowly granted database functions. No service-role key belongs in
the browser or repository.

## Setup gates

1. Connect a Supabase project to the `pudle` Vercel project. Keep its plan and
   region recorded. Configure `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the Vercel deployment.
2. Apply [the migration](../supabase/migrations/202609250001_convoy_obstacles.sql).
   Check that the `obstacle_reports` table is in `supabase_realtime`.
3. Keep email confirmation enabled and confirm both test accounts. If your
   project's email provider cannot deliver the messages, configure it before
   inviting outside testers.
4. Deploy from `deploy/vercel`, then run the two-account check below on the
   deployed URL. The owner-private legacy Sites app is independent.

## Two-phone check

Use two different real email accounts and two physical phones on a working
network. The vehicles should be parked while accounts, audio, and the convoy are
set up. If filming a drive, a passenger handles the lead phone.

1. Create both accounts and sign in on separate phones.
2. Create a convoy on the lead phone. Join by code on the following phone.
3. On the following phone, tap **Enable spoken reports**. Verify the short
   “audio is ready” utterance is audible at the intended volume.
4. On the lead phone, review and send **Tree or branch in road**. On the second
   phone, verify the fixed speech message and a visible report.
5. Lock or background the following phone and verify that no background speech
   promise is made. Reopen it; a report still inside its two-minute window
   should appear from the refresh path.
6. Repeat with a different convoy. A user outside the first convoy must not
   read its reports by changing a query or subscribing to its ID. Verify expired
   reports disappear and another user cannot insert as the lead account.

For timing, record the source phone's send action and the receiving phone's
first visible report on synchronized video. Note phone models, browser versions,
network, foreground state, and median/p95 over at least twenty reports.
There is no measured latency claim until this test runs.

## Release boundary

The current flow is person-confirmed. A camera seeing a fallen tree, automatic
classification, native “Hey Pudy,” Bluetooth relaying, locked-screen alerts,
and knowledge of which car is ahead require separate implementation and device
tests. Do not describe this demo as a validated collision-warning system.

Database rows expire from reads after two minutes but remain stored until a
retention job deletes them. Add and test that job before a larger pilot.
