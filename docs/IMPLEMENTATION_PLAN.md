# Pudle MVP implementation plan

## Goal

Deliver a recording-ready, mobile-first Pudle demo with real authenticated persistence, private local recordings, opt-in periodic cloud frame analysis, shared nearby events, invite-only group messaging, and the foreground Pudy voice companion.

## Vertical slices

1. **Foundation: identity and persistence**
   - Rename product-facing references to Pudle and Pudy.
   - Add secure server sessions, users, recording metadata, analysis results, road events, acknowledgements, groups, memberships, messages, and idempotency records.
   - Generate and review D1 migrations.
   - Add a demo-only seed/reset workflow and two real demo accounts.

2. **Private capture and opt-in cloud analysis** (backend complete; client capture remains)
   - Record the rear camera with supported MIME negotiation.
   - Save private media in browser storage with playback, export, and deletion.
   - Persist only recording metadata server-side.
   - Disclose cloud analysis before opt-in, sample bounded compressed frames, authenticate uploads, enforce limits/timeouts, and validate structured provider output.

3. **Nearby events and private ride communication**
   - Authenticated APIs now enforce coordinate rounding, two-mile filtering, 30-minute expiration, ownership, acknowledgement, resolution, and idempotency.
   - Invite-only ride membership uses transactional, expiry-guarded invite redemption; persisted plain-text messages use a never-reused sequence for stable cursor polling.
   - UI integration for reports, memberships, invites, and group messaging remains pending.

4. **Grounded Pudy and product experience**
   - Implement explicit foreground “Hey Pudy” listening with browser capability disclosure, tap/text fallbacks, and speech output.
   - Ground responses in the user’s latest permitted analysis and nearby events.
   - Allow only validated actions: save clip, prepare hazard report, and stop recording; require confirmation before sharing.
   - Finish Drive, Recordings, Ride, and Profile/Privacy surfaces and all degraded states.

5. **Proof and release**
   - Add unit, API, and two-session browser tests.
   - Require tests in CI; run lint, typecheck, tests, and production build.
   - Verify 320x568, 390x844, and 844x390 layouts.
   - Document live versus stubbed integrations, setup, migrations, demo seed/reset, retention, and a 60–90 second recording script.

## Acceptance checklist

- [ ] Two browser sessions have distinct stable server-side identities and isolated private data.
- [ ] Local recording supports start, elapsed time, stop, save, playback, export, deletion, interruption, and permission failure.
- [ ] Full recordings are never uploaded implicitly.
- [x] Cloud analysis backend is separately enabled with disclosure and analyzes only bounded compressed frames; client sampling remains.
- [x] Analysis API results include source, timestamp, confidence, uncertainty, and honest failure/unconfigured states.
- [ ] Events persist, reach another nearby user within five seconds, expire after 30 minutes, and support authorized acknowledge/resolve actions.
- [ ] Invite-only ride messages persist, poll without duplication, and remain member-only.
- [ ] Foreground “Hey Pudy” produces visible listening/thinking/speaking states and grounded concise answers.
- [ ] Pudy actions are allowlisted; sharing an event requires confirmation.
- [ ] Reload preserves identity, metadata, and messages; sign-out prevents cross-account access.
- [ ] Every API validates payload size and shape, authenticates server-side, authorizes ownership/membership, and rate-limits writes.
- [ ] Tests cover anonymous rejection, isolation, membership, limits, location privacy, expiry/radius, idempotency, untrusted content, provider failures, cleanup, and the two-session demo.
- [ ] Lint, typecheck, tests, build, responsive browser checks, and privacy review pass.

## External integration gate

Cloud analysis will use an official multimodal provider only when a server credential is present. The UI must remain visibly **Unconfigured** rather than presenting fixtures as live output. Automated tests may use a stub provider with synthetic images.
