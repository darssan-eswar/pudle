# Product roadmap and convoy trial

September 16, 2026. Stages below are gates, not promised completion dates.

## Feature ideas and feasibility

| Group | Useful first feature | Current boundary / next dependency |
|---|---|---|
| Capture | Save a private clip, replay, export | Implemented browser workflow; test every participating device |
| Heads Up | Review and share an observed road obstruction with the ride | Manual nearby reports exist; automatic VLM warnings remain disabled |
| Heads Back | Tell the group someone stopped or fell behind | Manual ride messaging exists; rear perception needs a rear camera, and tracking needs separate consent |
| Ride Together | Invitations, messages, arrival/check-in, regroup point | Invitations/messages exist; check-in and regroup UI are proposals |
| My Stops | Remember fuel-price, charging, or rest-stop interests | Temporary tab-local preferences and manual notes implemented; automatic extraction not connected |
| Energy | Compare a useful fuel stop or compatible charging stop | Needs verified prices, timestamps, vehicle/connector profile, route data, and explicit user confirmation |
| Pudy | Hands-free short requests with a clear listening state | Foreground browser speech only; native offline wake word is a separate build |
| Offline Exchange | Deliver small, expiring group observations when internet is absent | Not implemented; native peer transport and real-device tests required |
| Hardware | External road/rear camera and later a standalone dashcam | Capture adapter and radio specification needed; no hardware integration exists |

No feature should suggest speed changes, evasive maneuvers, or attention-demanding
interaction from experimental model output. Rear awareness is not blind-spot
detection. Heads Up and Heads Back are product categories, not safety claims.

## Architecture to build toward

```text
Phone / future dashcam
  camera or authorized vehicle sensor
    → bounded local detector / OCR / VLM
    → schema validation + evidence + timestamp
    → temporary private relevance filter
    → review / expiry / permission policy
       ├─ local display and optional parked review
       ├─ authenticated cellular/Wi-Fi backend (current transport)
       ├─ native BLE peer adapter (future)
       └─ external radio gateway (future LoRaWAN / Sidewalk)
```

Keep a shared event envelope independent of transport: version, random event ID,
category, capture time, expiry, provenance, bounded payload, and permitted coarse
location. Add authenticated sender/group scope, signatures, replay protection,
hop limits, duplicate suppression, rate limits, and revocation before peer
relaying. Do not broadcast account identity, exact travel history, or video.
Radio codecs can be smaller than server JSON, but must preserve expiry and trust
semantics. A transport accepting a message is not proof a recipient saw it.

The current backend already separates accounts, sessions, rides, messages,
reports, and analysis. The next native application should reuse these APIs, not
create a second source of truth. Local personalization starts with explicit
preferences and decaying memory, not uncontrolled fine-tuning while driving.
Training on contributed clips would be a separate opt-in, offline dataset
versioning and evaluation process with rollback and held-out release gates.

## What “any smartphone” can realistically mean

Use capability tiers rather than promising the same model on every phone:

- Baseline: sign-in, ride messages, confirmed reports, text controls; camera and
  recording only where the browser exposes usable media APIs.
- Local detection: a measured device-specific frame rate and thermal budget.
- Local VLM: explicit download, sufficient memory, supported WebGPU and f16;
  unsupported phones keep the baseline features without a silent cloud fallback.
- Native tier: offline wake-word audio, carefully scoped background execution,
  peer discovery, and hardware pairing after platform-specific implementation.

Test supported iPhone Safari/PWA and low-, mid-, and high-tier Android browsers
with actual models, OS versions, permission denial, screen lock, call
interruptions, Bluetooth audio, battery saver, and offline transitions recorded.
The current app has no service-worker offline shell: warmed model files can be
reused offline, but a full authenticated page reload still needs connectivity.
Do not equate model-cache recovery with a fully offline application.

## Transport and vehicle boundaries

- [Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth) is
  device/GATT access on supported browsers, not universal phone-to-phone mesh.
  Native iOS and Android adapters need their own scanning, advertising,
  permission, background, and battery tests.
- [Android nearby-device permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
  distinguish scanning, advertising, and connecting. Request permissions in
  context when the user enables a feature; do not ask for every possible future
  permission at installation.
- [LoRaWAN](https://lora-alliance.org/about-lorawan/) uses gateways and a
  star-of-stars network; it is not a synonym for peer mesh. Phones need external
  radios. Regional payload, airtime, and duty-cycle constraints must shape the
  codec and trial plan; no latency guarantee is assumed.
- [Amazon Sidewalk](https://docs.sidewalk.amazon/introduction/sidewalk-how-works.html)
  connects provisioned endpoints through participating bridges to the cloud.
  It is not a software switch that turns arbitrary phones into convoy relays.
- [Amazon Leo](https://leo.amazon.com/technology/) is a possible future backhaul
  through appropriate equipment, not a built-in phone radio. The supplied
  research note does not establish an available Sidewalk-to-Leo integration.
- [Tesla Fleet Telemetry](https://developer.tesla.com/docs/fleet-api/fleet-telemetry)
  is a possible owner-authorized sensor source, with eligibility, registration,
  pairing, and cost constraints. It does not give this MVP Tesla dashcam access
  or a native Tesla-to-Tesla app. Start read-only; do not issue vehicle commands.

Pair a future camera over BLE for provisioning/control if suitable; use an
appropriate higher-bandwidth interface for video rather than assuming a BLE
metadata link can carry continuous camera footage.

## Release stages

1. **Desktop checkpoint:** green tests/build, pinned model, clean dependency
   audit, clear UI limitations, scorer and proposal in Git. This release aims
   at this stage, not a completed convoy trial.
2. **Two parked phones:** one iPhone and one Android; check camera, actual audio,
   account isolation, messages, model download/cancel, reload, denied permissions,
   battery/thermal behavior, and zero unintended media uploads. Record evidence.
3. **Five-device rehearsal:** authorize the hosting audience, use invite-only
   rides, test account recovery/support, revocation, reconnect, congestion,
   and consent. Enable Gemini only after a secret and hard spend policy exist.
4. **Ten-device passenger-operated pilot:** experimental inference stays in
   shadow mode. Measure app stability, data usage, permissions and distractions.
   Pause for privacy leaks, unsafe distraction, crashes, or thermal warnings.
5. **50–80-person demo:** proceed only after device and backend capacity gates
   pass. Use multiple ride groups, a coordinator, a support contact, a stop
   procedure, and opt-out/deletion instructions. Record product demonstrations
   parked or by passengers. Do not ask drivers to handle the app while moving.
6. **Native/hardware research:** wake-word prototype, two-device BLE protocol,
   then multi-peer loss/replay tests. Add LoRa/Sidewalk gateways and read-only
   vehicle integrations separately; evaluate each before combining them.

Before stage 5, load-test a nonproduction backend with 80 simulated authenticated
users and realistic polling/message/report rates. Confirm access isolation,
rate limits, response latency, failure recovery, and a quota/cost budget. Passing
80 virtual users does not prove 80 physical phones or radio coverage work.

## Decisions and evidence still needed

- Approved hosting audience: current backend is owner-private.
- Secure Gemini credential and spend cap; no paid calls have been enabled.
- Participant devices, consent, event route/date, and a coordinator.
- Native platform builds and signing/distribution access for background voice/BLE.
- Vehicle permissions and hardware prototypes for sensor/radio integrations.
- Exact challenge rules before calling anything a submitted entry.

These are release dependencies, not things a desktop code test can satisfy.
