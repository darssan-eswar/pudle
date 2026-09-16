# Model register

Checked September 16, 2026 against publisher model cards. This is a shortlist,
not a leaderboard. The user's original three candidates remain in the study.

| Candidate | Published license | Proposed role | Pudle status |
|---|---|---|---|
| [SmolVLM-256M](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct) | Apache-2.0 | Small implemented baseline | Real CPU and compiled desktop WebGPU execution checked; phone unverified |
| [SmolVLM-500M](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct) | Apache-2.0 | First capacity comparison against 256M | Retained; not integrated or evaluated |
| [Qwen3-VL-2B](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct) | Apache-2.0 | Larger baseline for field extraction | Retained; not integrated or evaluated |
| [Gemma 4 E2B](https://ai.google.dev/gemma/docs/core/model_card_4) | Apache-2.0 | Google multimodal comparison on capable devices | Retained; not integrated or evaluated |
| [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) | Apache-2.0 | Newer small multimodal candidate | First additional evaluation candidate |
| [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B) | Apache-2.0 | Newer comparison at the 2B tier | Not integrated or evaluated |
| [LFM2.5-VL-450M](https://huggingface.co/LiquidAI/LFM2.5-VL-450M) | LFM Open License 1.0, custom terms | Small edge-oriented alternative | License and runtime review required |
| [LFM2.5-VL-1.6B](https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B) | LFM Open License 1.0, custom terms | Mid-size comparison | License and runtime review required |
| [LFM2.5-VL-3B](https://huggingface.co/LiquidAI/LFM2.5-VL-3B) | LFM Open License 1.0, custom terms | Larger recent reference | Not a default phone target |

Liquid's models are available weights under a custom license; do not label all
entries here as unrestricted open source. Review the exact
[license](https://huggingface.co/LiquidAI/LFM2.5-VL-450M/blob/main/LICENSE), including
commercial conditions, before redistribution or production selection. The
[3B publisher announcement](https://huggingface.co/blog/LiquidAI/lfm2-5-vl-3b)
is a recent addition to this family, not a Pudle performance result.

Gemma's effective parameter count is not its download size or peak memory.
Likewise, four-bit weight size alone excludes image encoders, activations, KV
cache, runtime overhead, and temporary loading buffers. Measure the whole app.

The LFM2.5-VL-450M card specifically cautions about fine-grained OCR. Fuel-price
digits, units, currency, and fuel grade need field-level evaluation and an OCR
baseline, not a fluent caption. Unreadable values must remain unknown.

## Selection order

1. Keep COCO-SSD plus manual reporting as the cheap baseline.
2. Compare SmolVLM-256M/500M and Qwen3.5-0.8B on the same consented still frames.
3. Add a specialist OCR pipeline for signs, recording its own license/runtime.
4. Compare Qwen3-VL-2B, Qwen3.5-2B, and Gemma E2B on higher-memory phones.
5. Add Liquid models after the license and export/runtime gates pass.
6. Use consented Gemini responses as a separately labeled cloud comparator;
   Gemini is neither local nor free simply because Copilot access is free.

Do not choose a winner before measuring accuracy, abstention, heat, memory,
latency, and energy. A detector-plus-OCR pipeline may beat a single VLM for
specific fields. That is a hypothesis to test, not a current result.

## Reproducibility record required per run

Record model repository and immutable revision; license snapshot; artifact
SHA-256; quantization for each component; tokenizer/processor revision; runtime
and backend; OS/browser/device; prompt hash; image preprocessing; token budget;
sampling settings; cache state; and run commit. Pin conversion repositories too.
Do not execute unreviewed remote model code or silently use `main` revisions.

Only the implemented 256M model currently has a Pudle revision pin:
`7e3e67edbbed1bf9888184d9df282b700a323964`. Other rows are research candidates,
not reproducible results. Transformers.js is pinned to 4.3.0; its
[release notes](https://github.com/huggingface/transformers.js/releases/tag/4.3.0)
add Safari 26 support, which still requires testing on our target phones.

## New and upcoming models

Recheck official Hugging Face publisher collections and release notes at each
experiment freeze. Add a candidate only when weights, a model card, licensing,
and an executable runtime are available. Keep announced but unreleased models
in a separate watch list with no scores. No unreleased model is currently a
dependency or a promised upgrade; no recurring monitoring has been enabled.
