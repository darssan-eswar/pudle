# Roadmap

These are possible next steps, not current capabilities or promised dates. [Implementation status](IMPLEMENTATION_PLAN.md) describes what is already delivered.

## Finish the demo

1. Resolve the public-app access decision and test accounts through the public address.
2. Configure and verify cloud analysis with non-sensitive test frames.
3. Check camera, microphone, and speech on the actual presentation phone.
4. Record the complete two-person flow and prepare the entry against the official challenge rules.

## Improve report quality

- Group duplicate reports from the same area and time window.
- Corroborate observations from independent users without publishing their identities.
- Improve stale-report handling and explain uncertainty more clearly.
- Add abuse controls based on tested failure cases rather than an unverified reputation score.
- Reduce client download size and measure performance on lower-end phones.

## Explore after the MVP

- Opt-in, aggregated parking observations and gas-price extraction.
- Offline report queues with clear expiry and replay behavior.
- A compact event format for LoRaWAN or other low-bandwidth transport.
- Aggregate fleet or infrastructure views.
- Read-only event access for other authorized applications.

These ideas need separate feasibility, privacy, and product decisions. Pudle does not currently include LoRaWAN hardware, municipal integrations, routing, or an autonomous-driving system.

## Keep these boundaries

Describe observable conditions, not accusations about a driver. Do not infer intoxication, intent, or culpability. Do not build a history of identifiable people or parked vehicles.

There is no verified contest deadline in this roadmap. The submission checklist lives in the [demo guide](SUBMISSION.md) and must be checked against the actual rules.
