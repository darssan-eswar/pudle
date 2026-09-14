---
name: mobile-overhaul
description: Implement Pudle's focused phone-first redesign without changing backend or privacy contracts.
agent: mobile-ux
---

Implement a phone-first redesign of Pudle as one focused pull request.

Target the authenticated app at `/app`. Preserve the separate public landing page at `/` unless the user explicitly requests a landing-page change. Read `docs/IMPLEMENTATION_PLAN.md` first and improve the existing controls rather than recreating them.

At widths below 768px, make the camera the primary first-screen surface. Add a compact privacy/network header, a safe-area-aware sticky Start/Stop Scan control, large Quick Report and Ask Pudy actions, and nearby alerts immediately below the camera or in an accessible collapsible sheet. Support 320px, 375px, 390px, and 430px portrait widths plus a landscape driver mode with the camera beside critical alerts.

Add clear onboarding and recovery for camera and approximate-location permissions. Represent model-loading, camera-denied, location-denied, offline, reconnecting, empty-feed, and report-success states without layout shifts. Lazy-load object detection only after Start Scan. Keep all controls keyboard accessible, visibly focused, and at least 48px high.

Do not change the backend event contract, add a UI framework without necessity, or weaken any privacy invariant. Add focused responsive tests, run every repository validation command, and list any verified limitation in the pull request.
