# Implementation status

This replaces the earlier work plan with the September 14, 2026 status. The remaining items are release checks, not claims that the whole demo is production-ready.

## Delivered

| Area | Implemented | Evidence |
|---|---|---|
| Accounts | Server sessions, per-user records, sign-out and session-expiry cleanup | Server/client tests; two-session local browser checks |
| Recording | Camera preview, local save, playback, export, deletion, metadata sync | Synthetic MediaRecorder and IndexedDB flow; physical phone still pending |
| Reports | Confirmed creation, coarse location, two-mile/30-minute filtering, acknowledgement and owner resolution | API tests and local two-account flow |
| Rides | Email-bound invites, member-only persisted text messages, stable polling cursor | API tests and local two-account flow |
| Pudy | User-enabled foreground wake phrase, displayed-data answers, allowlisted actions, sharing confirmation | Component tests with mocked speech; physical microphone/vendor service still pending |
| Cloud analysis | Consent checks, bounded frames, server-only provider adapter, output validation, limits and failure states | Synthetic/stub tests; no live provider credential |
| Landing | Product pitch at `/`, app at `/app`, static Vercel export | Local route tests and live desktop/phone-width checks |
| Release | Merged source, green CI, deployed Worker and D1 migrations | [Deployment record](DEPLOYMENT.md) |

## Remaining checks

- [ ] Approve public access to the existing backend and verify the app through Vercel with two accounts.
- [ ] Configure an approved provider secret and verify an actual consented analysis request.
- [ ] Test rear camera, physical microphone, speech recognition, and audible replies on the presentation phone.
- [ ] Check the complete app in the presentation phone's portrait and landscape layouts.
- [ ] Confirm the official challenge rules and finish the entry.

[Verification](VERIFIED.md) records the checks already performed. [Roadmap](ROADMAP.md) contains later ideas that are not part of the release.
