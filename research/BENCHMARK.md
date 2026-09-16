# Pudle-Edge benchmark proposal v0

Status: protocol and scoring scaffold. No real road dataset, comparative model
results, or phone-performance results have been collected.

## Tasks and ground truth

| Track | Input and expected output | Primary measures |
|---|---|---|
| Grounded observation | Consented frame/short clip → category, evidence region, observable fields or unknown | Per-field exact match, category precision/recall, hallucination and abstention |
| Personal relevance | Same scene plus an explicit interest profile → relevant/not relevant | Precision/recall, balanced accuracy, irrelevant interruptions |
| Freshness and policy | Observation, age, provenance, confirmation → discard/review/personal/routine | Stale acceptance, unsafe promotion, useful retained information |
| Runtime | Identical bounded task on named device and runtime | Cold/warm load, p50/p95 end-to-end latency, memory, crash rate, energy and temperature |
| Delivery | Replay identical metadata through controlled loss/latency profiles | Bytes per useful event, delivery before expiry, duplicates, fairness across peers |

Categories begin with road hazard, fuel price, charging, rest stop, vehicle
energy, and unknown. Add subtypes only when annotators can distinguish them
reliably. Vehicle energy requires an actual dashboard view or authorized sensor;
a forward road image cannot supply a hidden fuel gauge. Rear observations need
a rear camera. A charging sign does not establish live availability, connector
compatibility, or a working charger.

Use paired profiles (fuel prices important, charging important, neither) for
the same frame. A profile changes relevance, never visual ground truth or
safety urgency. Include negated interests and expiration. Text visible in
the scene is data, not permission to change app settings or issue commands.

## Dataset and split plan

Collect only separately consented research footage. Product participation is
not training consent. Keep raw clips out of Git, restrict access, redact
identifying faces/plates where feasible, and define retention and deletion
before collection. Begin with staged, parked scenes and licensed existing data.
[nuScenes/nuImages](https://www.nuscenes.org/nuimages) have non-commercial terms;
do not assume every public driving dataset permits product training.

Assign entire trips to one split; additionally hold out locations, vehicles,
drivers, and repeated signs to reduce leakage. Deduplicate adjacent frames and
near-duplicate trips before splitting. Reserve test labels; choose prompts,
thresholds, quantization, and model selection using training/validation only.
The current CLI detects repeated trip IDs across splits but cannot detect
visual, location, driver, or vehicle leakage by itself.

Two independent annotators mark visible evidence, ambiguous fields, source
time, and occlusion; adjudicate disagreements without seeing model predictions.
Report agreement and sample counts. Stratify by day/night, rain/glare, blur,
urban/rural, camera placement, device tier, region, currency/units, and category.
Do not infer a population result from 50 friends or count neighboring frames as
independent participants. Determine sample size after a pilot estimates error
rates and within-trip correlation; publish trip-bootstrap confidence intervals.

## Experimental controls

- Freeze a device-specific resource envelope before testing. Report failures and
  unsupported devices, not just successful runs.
- Compare model-only runs with identical inputs separately from end-to-end
  pipelines with detector/OCR cropping, scheduling, and networking.
- Use fixed prompts, resolution, deterministic decoding where supported, and
  output-token limits. Record any backend nondeterminism.
- Repeat cold and warm runs in randomized order. Include 30-minute sustained
  runs with screen/camera state, starting battery, ambient temperature, charging
  state, and thermal throttling recorded. Energy measured by hardware/OS tools
  must be distinguished from coarse battery-percentage estimates.
- Reject malformed schemas and abstain on unreadable fields. A numeric confidence
  invented by a language model is not calibrated probability. Evaluate selective
  risk/coverage and calibration on a defined score before using thresholds.
- Measure false alerts per hour only from complete time-labeled sequences with
  a predeclared alert policy and exposure denominator. Still-image classification
  cannot produce that metric. Current Pudle has no automatic safety-alert policy.
- Network traces are controlled experiments, not proof of LoRa, Sidewalk, BLE,
  or cellular field performance. Separate each actual radio's tests later.

## Current executable scaffold

```bash
npm run benchmark:metadata -- research/fixtures/synthetic-predictions.json
```

This command scores **fabricated predictions and latencies** solely to test the
reporting code. It does not load a model, call Gemini, inspect footage, or create
real benchmark results. It reports test-set category/relevance accuracy,
per-category precision/recall, abstention, policy discards, and supplied p50/p95
latency. Calibration, OCR fields, confidence intervals, energy, per-condition
scores, and false alerts/hour are proposed work, not implemented metrics.

The JSON input is an array (1–10,000 rows, file at most 2 MB):

```json
{
  "id": "case_001",
  "tripId": "trip_A",
  "split": "test",
  "expected": "fuel-price",
  "predicted": "unknown",
  "relevant": false,
  "expectedRelevant": true,
  "confidence": 0.2,
  "ageMs": 1000,
  "latencyMs": 250
}
```

Wrap rows in an array. This example is synthetic. Split values are `train`,
`validation`, and `test`; only test rows are scored. IDs must be unique and a
trip cannot span splits. Unknown is a valid abstention. Undefined precision or
recall is reported as null, not zero or a fabricated perfect score.

The policy module never authorizes an automatic driving alert. Expired,
invalid, and unknown observations are discarded; unconfirmed observations
and hazards require review. This research policy is not a replacement for the
existing manually confirmed road-report service.

## Deliverables before a paper or model selection

1. Preregister tasks, splits, measurements, failure criteria, and analysis plan.
2. Publish a data card and license/consent record without private media.
3. Add per-model runners and immutable run manifests; audit their preprocessing.
4. Produce repeatable named-device results and failure examples.
5. Release scorer, prompts, permitted test assets, and anonymized aggregate
   results. Clearly separate a usability pilot from a safety validation study.
