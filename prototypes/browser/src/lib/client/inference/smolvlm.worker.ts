/// <reference lib="webworker" />

import {
  AutoModelForVision2Seq,
  RawImage,
} from '@huggingface/transformers';
import { loadPinnedSmolVlmProcessor, readBrowserProcessorJson } from './smolvlm-processor';
import {
  SMOLVLM_MAX_INPUT_DIMENSION,
  SMOLVLM_MAX_NEW_TOKENS,
  SMOLVLM_MODEL,
  SMOLVLM_PROMPT,
  SMOLVLM_REVISION,
  type SmolVlmWorkerRequest,
  type SmolVlmWorkerResponse,
} from './smolvlm-contract';

interface WorkerNavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<{
      features: { has(feature: string): boolean };
    } | null>;
  };
}

interface ProgressEvent {
  status?: unknown;
  file?: unknown;
  loaded?: unknown;
  total?: unknown;
  progress?: unknown;
}

const scope = self as DedicatedWorkerGlobalScope;
let processor: Awaited<ReturnType<typeof loadPinnedSmolVlmProcessor>> | null = null;
let model: Awaited<ReturnType<typeof AutoModelForVision2Seq.from_pretrained>> | null = null;
let loading: Promise<void> | null = null;
let describing = false;
const downloads = new Map<string, { loaded: number; total: number }>();

function post(message: SmolVlmWorkerResponse): void {
  scope.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The local model failed.';
}

function progress(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const event = value as ProgressEvent;
  const file = typeof event.file === 'string' ? event.file : undefined;
  const loaded = typeof event.loaded === 'number' && Number.isFinite(event.loaded)
    ? Math.max(0, event.loaded)
    : undefined;
  const total = typeof event.total === 'number' && Number.isFinite(event.total)
    ? Math.max(0, event.total)
    : undefined;
  if (file && loaded !== undefined && total !== undefined && total > 0) {
    downloads.set(file, { loaded: Math.min(loaded, total), total });
  }
  const aggregate = [...downloads.values()].reduce(
    (sum, item) => ({
      loaded: sum.loaded + item.loaded,
      total: sum.total + item.total,
    }),
    { loaded: 0, total: 0 },
  );
  const eventProgress = typeof event.progress === 'number' && Number.isFinite(event.progress)
    ? event.progress
    : undefined;
  post({
    type: 'progress',
    progress: aggregate.total > 0
      ? (aggregate.loaded / aggregate.total) * 100
      : Math.min(100, Math.max(0, eventProgress ?? 0)),
    downloadedBytes: aggregate.total > 0 ? aggregate.loaded : undefined,
    totalBytes: aggregate.total > 0 ? aggregate.total : undefined,
    file,
  });
}

async function assertWebGpu(): Promise<void> {
  const gpu = (scope.navigator as unknown as WorkerNavigatorWithGpu).gpu;
  if (!gpu) throw new Error('WebGPU is unavailable in the local model worker.');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  if (!adapter.features.has('shader-f16')) {
    throw new Error('The local model requires WebGPU shader-f16 support.');
  }
}

async function load(): Promise<void> {
  if (processor && model) {
    post({ type: 'ready' });
    return;
  }
  if (loading) return loading;
  loading = (async () => {
    await assertWebGpu();
    downloads.clear();
    processor = await loadPinnedSmolVlmProcessor(readBrowserProcessorJson);
    model = await AutoModelForVision2Seq.from_pretrained(SMOLVLM_MODEL, {
      revision: SMOLVLM_REVISION,
      device: 'webgpu',
      dtype: {
        embed_tokens: 'q4f16',
        vision_encoder: 'q4f16',
        decoder_model_merged: 'q4f16',
      },
      progress_callback: progress,
    });
    post({ type: 'ready' });
  })().catch((error) => {
    processor = null;
    model = null;
    post({ type: 'error', message: errorMessage(error) });
  }).finally(() => {
    loading = null;
  });
  return loading;
}

function assertDescribeRequest(
  value: SmolVlmWorkerRequest,
): asserts value is Extract<SmolVlmWorkerRequest, { type: 'describe' }> {
  if (
    value.type !== 'describe'
    || !value.requestId
    || !Number.isInteger(value.width)
    || !Number.isInteger(value.height)
    || value.width < 1
    || value.height < 1
    || value.width > SMOLVLM_MAX_INPUT_DIMENSION
    || value.height > SMOLVLM_MAX_INPUT_DIMENSION
    || !(value.pixels instanceof ArrayBuffer)
    || value.pixels.byteLength !== value.width * value.height * 4
  ) {
    throw new Error('The local model received an invalid frame.');
  }
}

async function describe(
  request: Extract<SmolVlmWorkerRequest, { type: 'describe' }>,
): Promise<void> {
  assertDescribeRequest(request);
  if (!processor || !model) throw new Error('Load the local model before describing a frame.');
  if (describing) throw new Error('A local description is already running.');
  describing = true;
  try {
    const image = new RawImage(
      new Uint8ClampedArray(request.pixels),
      request.width,
      request.height,
      4,
    ).rgb();
    const messages = [{
      role: 'user',
      content: [
        { type: 'image' },
        { type: 'text', text: SMOLVLM_PROMPT },
      ],
    }];
    const text = processor.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    const inputs = await processor(text, [image], {
      do_image_splitting: false,
    });
    const output = await model.generate({
      ...inputs,
      do_sample: false,
      repetition_penalty: 1.1,
      max_new_tokens: SMOLVLM_MAX_NEW_TOKENS,
    });
    if (!output || typeof output !== 'object' || !('slice' in output)) {
      throw new Error('The local model returned an unreadable token sequence.');
    }
    const promptLength = inputs.input_ids.dims[1];
    const generated = output.slice(null, [promptLength, null]);
    const decoded = processor.batch_decode(generated, {
      skip_special_tokens: true,
    });
    post({
      type: 'result',
      requestId: request.requestId,
      description: decoded[0] ?? '',
    });
  } finally {
    describing = false;
  }
}

scope.addEventListener('message', (event: MessageEvent<SmolVlmWorkerRequest>) => {
  const request = event.data;
  if (!request || typeof request !== 'object') {
    post({ type: 'error', message: 'The local model received an invalid request.' });
    return;
  }
  if (request.type === 'load') {
    void load();
    return;
  }
  if (request.type === 'describe') {
    void describe(request).catch((error) => {
      post({
        type: 'error',
        requestId: request.requestId,
        message: errorMessage(error),
      });
    });
    return;
  }
  post({ type: 'error', message: 'The local model received an unsupported request.' });
});
