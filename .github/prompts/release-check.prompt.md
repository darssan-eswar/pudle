---
name: release-check
description: Review a Pudle change for privacy, mobile quality, and release readiness.
agent: qa-reviewer
---

Review the proposed release without changing product scope.

Inspect the complete diff and test affected behavior. Apply the repository review matrix, including phone viewports, accessibility, degraded browser states, event radius and expiration, coordinate privacy, server-only secrets, sensitive logging, and optional inference failure. Run lint, TypeScript, all available tests, the production build, and the static landing export. A documentation-only change still needs valid links and commands; it does not require a database migration or deployment.

Check the current release record in `docs/DEPLOYMENT.md`. A merged PR is not proof of deployment, a deployed app may still be access-restricted, and mocked speech is not physical microphone proof. Do not change audience, configure secrets, merge, or deploy as part of a review-only task.

Report only actionable findings with severity, evidence, and reproduction steps. If no blocking issue remains, state what was verified and identify any untested risk without implying it passed.
