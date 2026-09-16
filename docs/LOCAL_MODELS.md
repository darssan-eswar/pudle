# Local models

Pudle keeps local object detection, local frame description, and consented cloud
analysis independent. Failure or unloading of either local model does not block
camera capture, recording, manual reporting, Ride, Pudy, or Gemini cloud
analysis.

## COCO-SSD scene detection

COCO-SSD `lite_mobilenet_v2` runs through the portable contract in
`src/lib/client/inference/`. It loads after camera activation and returns at most
four validated labels with confidence values at or above 0.6. The scheduler:

- permits one inference at a time and starts frames no faster than every 1.5 seconds;
- records model/source, capture and completion times, and measured latency;
- disposes on camera stop, leaving Drive, hidden page, sign-out, or unmount;
- discards results that resolve after cancellation;
- never encodes, persists, or uploads its input frame.

TensorFlow.js does not cancel an operation already executing inside COCO-SSD.
Pudle disposes the adapter, waits before any restart, and rejects a late result.

## Optional SmolVLM prototype

The manual **Describe frame** prototype uses
[`HuggingFaceTB/SmolVLM-256M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct),
Apache-2.0, pinned to revision
`7e3e67edbbed1bf9888184d9df282b700a323964`. Transformers.js is pinned to
`4.3.0`.

The browser path requires WebGPU with `shader-f16`. Pudle does not start the
download until the user checks the disclosure and taps **Download local model**.
The download is approximately 260 MB of quantized model weights plus runtime
files; actual transfer and browser-cache usage vary. Progress is shown while
files load. Browser caching can retain public model artifacts, but Pudle does
not put camera pixels in that cache.

Transformers.js loads its ONNX WASM/runtime files from jsDelivr using the exact
`onnxruntime-web` version in the lockfile. The build pins fallback URLs to that
same location instead of packaging a redundant WASM file over the host's 25 MiB
asset limit. Runtime downloads contain public code, not camera data. The build
checks all emitted static asset sizes before packaging.

After loading:

- generation occurs only after **Describe frame** is tapped;
- input is resized to at most 512 pixels on its longest side;
- only one request can run, with at most 64 new tokens;
- a fixed prompt requests directly observable conditions and excludes identity,
  intent, intoxication, ownership, fault, location, and plate text;
- bounded output is rejected if it contains prohibited identity, plate,
  intoxication, ownership, or culpability claims;
- Stop, timeout, hidden page, leaving Drive, sign-out, session expiry, and
  unmount terminate the dedicated worker, which is the hard cancellation
  boundary;
- transferred pixels are not uploaded, written to storage, used to create
  alerts, or used to trigger actions.

Descriptions are experimental and may be wrong. This is not a driver-warning
system and has no background or locked-phone behavior.

## Reproducible checks

```bash
npm run evaluate:local-model
npm run smoke:smolvlm
npm run smoke:smolvlm -- --offline
```

`evaluate:local-model` runs deterministic synthetic fixtures against the
portable scheduler contract. It verifies validation, sequencing, cleanup, and
latency measurement only.

`smoke:smolvlm` downloads the exact pinned revision, uses generated nonprivate
64×64 RGB pixels, runs real CPU inference through Transformers.js, verifies that
tokens are generated, and reports load time, inference time, and observed
process RSS. Its cache defaults to ignored `.cache/pudle-models/`; set
`PUDLE_MODEL_CACHE` to another local cache if needed. The command prints no
model description because synthetic pixels do not provide meaningful semantic
evidence.

The offline option requires a previously warmed cache and rejects every network
attempt. Processor/tokenizer JSON comes from the same pinned revision as the
weights; it no longer probes the mutable `main` branch during discovery. Browser
Cache API loading has regression tests; real browser/phone offline model reload
still needs a device check. Cache eviction or an incomplete download requires
connectivity. This does not add an offline app shell or offline authentication.

Neither command measures road-scene accuracy.

## Model candidates

Only SmolVLM-256M is implemented. Retained Apache-2.0 candidates for later,
separately reviewed experiments are:

| Candidate | Why it remains a candidate | Current status |
|---|---|---|
| SmolVLM-500M | More capacity with a still-mobile-oriented family | Not implemented |
| Qwen3-VL-2B | Larger vision-language baseline | Not implemented; likely beyond many phone budgets |
| [Gemma 4 E2B](https://ai.google.dev/gemma/docs/core/model_card_4) | Google open multimodal baseline | Not implemented |

No candidate should replace the current model without target-browser runtime,
memory, licensing, and road-task evaluation. The expanded [model register](../research/MODELS.md)
includes Qwen3.5 and Liquid candidates, exact status, license caveats, and the
experiment record required before comparison.

## Temporary interests

Pudy can recognize explicit fuel-price or charging interests. Profile also
supports rest-stop interests and confirmed notes. Interests expire after 12
hours; notes expire by category, and everything clears on reload or sign-out.
No memory is uploaded, used to train weights, or automatically filled from a
camera. Negated commands do not enable an interest. Automatic fuel-gauge reading,
charger availability, vehicle integration, and native wake-word detection are
not implemented.

The [research protocol](../research/BENCHMARK.md) separates personal relevance
from safety urgency and documents the supplied-prediction scoring harness.

## Road evaluation gates

A model cannot be described as road-ready from synthetic fixtures or a single
demo. Promotion requires a consented, licensed, held-out dataset of labeled road
clips separated by trip and location, plus:

- false alerts per hour;
- recall reported separately by weather and lighting condition;
- p50 and p95 end-to-end latency on named target phones;
- peak model/runtime memory;
- thirty-minute thermal and battery measurements;
- documented failure cases and a review that model output cannot bypass report
  confirmation or privacy controls.

Raw evaluation clips must not be committed or mixed across train and held-out
trips. Any data collection needs its own consent, retention, and licensing
review.
