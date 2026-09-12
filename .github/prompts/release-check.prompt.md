---
name: release-check
description: Review a Pulzar change for privacy, mobile quality, and release readiness.
agent: qa-reviewer
---

Review the proposed release without changing product scope.

Inspect the complete diff and test affected behavior. Apply the repository review matrix, including phone viewports, accessibility, degraded browser states, event radius and expiration, coordinate privacy, server-only secrets, sensitive logging, and optional inference failure. Run lint, TypeScript, all available tests, and the production build.

Report only actionable findings with severity, evidence, and reproduction steps. If no blocking issue remains, state what was verified and identify any untested risk without implying it passed.
