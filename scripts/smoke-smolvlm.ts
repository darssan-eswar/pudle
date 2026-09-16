import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  AutoModelForVision2Seq,
  env,
  RawImage,
} from '@huggingface/transformers';
import {
  SMOLVLM_MAX_NEW_TOKENS,
  SMOLVLM_MODEL,
  SMOLVLM_PROMPT,
  SMOLVLM_REVISION,
} from '../src/lib/client/inference/smolvlm-contract';
import { loadPinnedSmolVlmProcessor, processorFileUrl } from '../src/lib/client/inference/smolvlm-processor';

const allowedArguments = new Set(['--help', '--offline']);
const offline = process.argv.includes('--offline');
let networkAttempts = 0;
if (offline) {
  const rejectNetwork = async () => {
    networkAttempts += 1;
    throw new Error('Network access prohibited by --offline smoke test.');
  };
  globalThis.fetch = rejectNetwork;
  env.fetch = rejectNetwork;
}
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error(`Unsupported argument: ${argument}`);
  }
}
if (process.argv.includes('--help')) {
  console.log(
    'Downloads and runs the pinned SmolVLM revision on generated pixels. '
    + 'Use --offline to assert zero network requests with a warm cache. '
    + 'Set PUDLE_MODEL_CACHE to override the ignored cache directory.',
  );
  process.exit(0);
}

const cacheInput = process.env.PUDLE_MODEL_CACHE?.trim() || '.cache/pudle-models';
if (cacheInput.includes('\0')) {
  throw new Error('PUDLE_MODEL_CACHE contains an invalid null byte.');
}
const cacheDir = resolve(cacheInput);
await mkdir(cacheDir, { recursive: true });

env.allowLocalModels = offline;
env.allowRemoteModels = !offline;
env.useFSCache = true;
env.cacheDir = cacheDir;

const width = 64;
const height = 64;
const pixels = new Uint8Array(width * height * 3);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3;
    pixels[offset] = Math.round((x / (width - 1)) * 255);
    pixels[offset + 1] = Math.round((y / (height - 1)) * 255);
    pixels[offset + 2] = (x + y) % 2 === 0 ? 32 : 224;
  }
}
const image = new RawImage(pixels, width, height, 3);
const startedAt = performance.now();
const rssBefore = process.memoryUsage().rss;

const processor = await loadPinnedSmolVlmProcessor(async (file) => {
  const directory = resolve(cacheDir, SMOLVLM_MODEL, SMOLVLM_REVISION);
  const path = resolve(directory, file);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || offline) throw error;
    const response = await fetch(processorFileUrl(file), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Download failed: ${file}`);
    contents = await response.text();
    JSON.parse(contents);
    await mkdir(directory, { recursive: true });
    await writeFile(path, contents, { flag: 'wx' });
  }
  return JSON.parse(contents) as Record<string, unknown>;
});
const model = await AutoModelForVision2Seq.from_pretrained(SMOLVLM_MODEL, {
  revision: SMOLVLM_REVISION,
  local_files_only: offline,
  device: 'cpu',
  dtype: {
    embed_tokens: 'q4',
    vision_encoder: 'q4',
    decoder_model_merged: 'q4',
  },
});
const loadedAt = performance.now();
const rssAfterLoad = process.memoryUsage().rss;

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
const inputs = await processor(text, [image], { do_image_splitting: false });
const output = await model.generate({
  ...inputs,
  do_sample: false,
  max_new_tokens: Math.min(16, SMOLVLM_MAX_NEW_TOKENS),
});
if (!output || typeof output !== 'object' || !('slice' in output)) {
  throw new Error('The pinned model returned an unreadable token sequence.');
}
const promptLength = inputs.input_ids.dims[1];
const generated = output.slice(null, [promptLength, null]);
const decoded = processor.batch_decode(generated, { skip_special_tokens: true });
if (typeof decoded[0] !== 'string' || !decoded[0].trim()) {
  throw new Error('The pinned model returned no generated tokens.');
}
const completedAt = performance.now();
const rssAfterInference = process.memoryUsage().rss;
await model.dispose();
if (offline && networkAttempts !== 0) throw new Error('Offline run attempted a network request.');

console.log(JSON.stringify({
  disclaimer:
    'Generated nonprivate pixels verify model loading and execution only; no road accuracy is measured.',
  model: SMOLVLM_MODEL,
  revision: SMOLVLM_REVISION,
  runtime: 'Transformers.js CPU / ONNX Runtime',
  offline,
  networkAttempts: offline ? networkAttempts : null,
  input: { width, height, channels: 3, generated: true },
  maxNewTokens: Math.min(16, SMOLVLM_MAX_NEW_TOKENS),
  loadMs: Math.round(loadedAt - startedAt),
  inferenceMs: Math.round(completedAt - loadedAt),
  totalMs: Math.round(completedAt - startedAt),
  rssBytes: {
    before: rssBefore,
    afterLoad: rssAfterLoad,
    afterInference: rssAfterInference,
    peakObserved: Math.max(rssBefore, rssAfterLoad, rssAfterInference),
  },
  cacheDir,
}, null, 2));
