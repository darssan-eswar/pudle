# Pulzar product plan

## Product definition

**One-liner:** Pulzar is the private nervous system for smart cities.

**Initial wedge:** A phone-based smart dashcam that converts live road video into anonymous, short-lived road-event metadata and shares it with drivers within two miles.

**Long-term platform:** A distributed metadata network spanning phones, vehicles, LoRaWAN gateways, infrastructure sensors, and autonomous systems. Raw video stays at the edge; routing systems consume only actionable events.

## Stage 1 — Working contest MVP

The demo must prove the full loop, not every future feature:

1. Start the phone camera.
2. Show objects being detected locally with bounding boxes.
3. Submit an observable road event.
4. Show it appearing in the live two-mile feed.
5. Ask Pulzar what is ahead and hear a spoken answer.
6. Explain that raw video is never uploaded and the report expires in 30 minutes.

## Stage 2 — Credible intelligence

- Multi-driver corroboration: confidence rises when independent devices observe the same event.
- Duplicate clustering: nearby reports within a short window become one event.
- Reputation without identity: rotating device attestations reduce spam without creating a movement history.
- On-device gas-price OCR: extract station, grade, and price locally; store only price metadata with a short freshness window.
- Parking inference: detect likely curb-space availability during normal drives, with explicit opt-in and street-level aggregation. Do not continuously map individual vehicles.
- Traffic-light learning: estimate queue length and observed phase duration; label timing as probabilistic rather than authoritative.
- Offline queue: hold signed metadata when connectivity drops and forward it through HTTPS or LoRaWAN when available.

## Stage 3 — Pulzar network

- Gateway bridge translating the web event envelope to compact LoRaWAN payloads.
- Flood, levee, road-temperature, and infrastructure sensor ingestion.
- Fleet and municipal dashboard with aggregate coverage, sensor health, and incident confidence.
- Routing SDK for navigation providers.
- Read-only MCP server exposing nearby, expiring road events to authorized vehicle agents.
- Drone connectivity and charging nodes as a separate infrastructure product after the road network has density.

## Product decisions

### Use observed behavior, not accusations

The product should report “reckless driving,” “weaving,” “hard braking,” or “wrong-way vehicle.” It should not label someone a drunk driver. Impairment cannot be reliably inferred from a phone camera, and the accusation creates unnecessary safety and legal risk.

### Parking should be passively collected, actively queried

The best experience is hybrid: opted-in devices detect likely curb availability during ordinary driving, but Pulzar only surfaces aggregated, fresh availability when somebody asks for parking. This creates useful coverage without rerouting contributors or retaining a trace of parked cars.

### LoRaWAN is the transport moat, not the first demo dependency

The web MVP should prove the event protocol and demand. A gateway bridge can then carry the same metadata in low-bandwidth environments. The user experience should work over ordinary internet today and gain resilience from LoRaWAN later.

## September 30 contest checklist

- Public GitHub repository with a clear README and license
- Public, mobile-friendly working deployment
- 45–60 second screen recording showing camera, local detection, report, live feed, and voice answer
- Architecture diagram showing `camera → on-device inference → metadata → D1/LoRa bridge → nearby driver`
- Social post tagging GitHub Education
- Microsoft Form submission containing repository, live demo, evidence video, and social link

Suggested submission description:

> Pulzar turns any phone into a privacy-first road-intelligence node. Its camera detects road objects locally, shares only anonymous and expiring metadata, and alerts drivers within two miles through a live database-backed feed and voice interface. I built the MVP with React, TypeScript, TensorFlow.js, Cloudflare D1, and GitHub Copilot Pro+, with a metadata protocol designed to bridge into Pulzar's LoRaWAN gateway network.
