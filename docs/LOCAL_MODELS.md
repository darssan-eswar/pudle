# Local model foundation

Pudle's local inference boundary lives in `src/lib/client/inference/`. It is deliberately model-agnostic so a later reviewed model can implement the same contract without changing camera, recording, reporting, or cloud-analysis behavior.

## Current adapter

The existing COCO-SSD `lite_mobilenet_v2` detector remains the only integrated local model. It loads only after the user enables the camera. The adapter returns at most four validated labels with confidence values at or above 0.6. It does not copy, persist, or upload the input frame.

The scheduler exposes explicit capability, loading, ready, and error states. It:

- permits only one inference at a time;
- starts frames no faster than once every 1.5 seconds;
- attaches `source`, `model`, capture time, completion time, and measured latency to each result;
- aborts and disposes the adapter when the camera is stopped, the user leaves Drive, the page becomes hidden, the account signs out, or the component unmounts;
- ignores results that resolve after cancellation;
- leaves camera capture, recording, and manual reporting available when model loading or inference fails.

COCO-SSD's browser API does not cancel an operation already executing inside TensorFlow.js. Pudle aborts the scheduler, disposes the model, blocks another inference until the pending operation settles, and discards any late result.

## Reproducible software evaluation

Run:

```bash
npm run evaluate:local-model
```

The harness validates a bounded list of fixtures, runs them sequentially through the portable adapter contract, and reports model/source identity, start and completion times, measured latency, and observation counts. It never includes fixture inputs or raw model observations in its report.

The committed fixtures are synthetic deterministic workloads. They verify input validation, scheduling, cleanup, and latency measurement only. They do **not** measure object-detection quality, road-scene accuracy, safety performance, or readiness for a particular phone. A real model evaluation requires a separately reviewed dataset, labels, consent and licensing review, target-device measurements, and task-specific accuracy metrics.

## Adding another local model

A future adapter must implement `LocalModelAdapter<Input>` and preserve the same lifecycle. Model selection must document:

- license and redistribution terms;
- browser runtime and model-file size;
- supported devices and fallback behavior;
- bounded input shape and output validation;
- measured latency and memory on target phones;
- task-specific evaluation data that contains no private user media.

No new model or runtime dependency is selected by this foundation.
