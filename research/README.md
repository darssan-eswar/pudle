# Pudle edge metadata research

Proposal, September 16, 2026. No road benchmark results have been collected.

**Research question:** What is the smallest practical perception pipeline that
can extract useful, fresh driving metadata on a phone, recognize when it does
not know, and respect a driver's temporary interests?

This is research for a safety-relevant setting, not a claim that Pudle is a
mission-critical or certified driver-assistance system.

## Working abstract

Small vision-language models could turn locally captured driving video into
compact observations without continuously uploading footage. Existing caption
and question-answering scores do not establish whether those observations are
accurate, timely, or useful to an individual driver. We propose Pudle-Edge, an
evaluation protocol for grounded metadata extraction under mobile compute,
energy, privacy, and intermittent-connectivity constraints. The study separates
three decisions: what is observable, what matches a driver's explicit temporary
interests, and what is sufficiently corroborated and fresh to present. Candidate
pipelines combine compact vision-language models, object detection, and optional
specialist OCR. Evaluation covers road conditions, fuel-price signs, charging
information, and vehicle-energy observations when an authorized sensor or camera
view supplies evidence. Trip- and location-separated test sets measure field
accuracy, abstention, calibration, information age, latency, energy, and thermal
behavior on named devices. Controlled network replay measures useful metadata
delivered before expiry rather than raw message throughput. A staged convoy
study would assess feasibility and usability, with experimental inference in
shadow mode and no automated safety warnings. The intended contribution is a
reproducible method for comparing model-and-runtime trade-offs and personalized
metadata utility; it is not a new driving model or evidence of safe autonomous
decision-making.

## What exists now

- A pinned SmolVLM-256M manual frame-description prototype and real CPU smoke test.
- Cached processor loading without an unpinned tokenizer discovery request.
- Private, tab-lifetime interests and expiring user-entered notes. This is working
  memory, not training or automatic learning from drives.
- A deterministic metadata policy and a scoring CLI for supplied predictions.
  Neither is connected to automatic driving alerts.
- A synthetic fixture for testing the scorer, **not model evaluation evidence**.

[Model register](MODELS.md) · [Benchmark protocol](BENCHMARK.md) ·
[Product and convoy roadmap](ROADMAP.md)

## Research context

[DriveLM](https://arxiv.org/abs/2312.14150) evaluates driving through connected
perception, prediction, and planning questions.
[EM-VLM4AD](https://arxiv.org/abs/2403.19838) studies lightweight multi-frame
visual question answering for driving.
[ReasonDrive](https://arxiv.org/abs/2504.10757) is a related small-model reasoning
baseline. These are comparison points, not evidence that our implementation
inherits their results.

Pudle's proposed focus is narrower: evidence-bound fields, per-driver relevance,
expiry-aware delivery, and measured phone costs. A literature review must test
whether that combination is a useful contribution before claiming novelty.
