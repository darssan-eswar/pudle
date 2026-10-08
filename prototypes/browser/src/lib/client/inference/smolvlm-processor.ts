import { GPT2Tokenizer, Idefics3ImageProcessor, Idefics3Processor } from '@huggingface/transformers';
import { SMOLVLM_MODEL, SMOLVLM_REVISION } from './smolvlm-contract';

export const SMOLVLM_PROCESSOR_FILES = [
  'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'processor_config.json',
] as const;
export type ProcessorFile = typeof SMOLVLM_PROCESSOR_FILES[number];

export function processorFileUrl(file: ProcessorFile): string {
  return `https://huggingface.co/${SMOLVLM_MODEL}/resolve/${SMOLVLM_REVISION}/${file}`;
}

// Explicit constructors avoid Transformers.js 4.3's unpinned tokenizer discovery
// probe. Every artifact comes from the same immutable revision, including offline.
export async function loadPinnedSmolVlmProcessor(
  readJson: (file: ProcessorFile) => Promise<Record<string, unknown>>,
): Promise<Idefics3Processor> {
  const [tokens, tokenizer, image, processor] = await Promise.all(
    SMOLVLM_PROCESSOR_FILES.map(readJson),
  );
  if (tokenizer.tokenizer_class !== 'GPT2Tokenizer'
    || image.image_processor_type !== 'Idefics3ImageProcessor'
    || processor.processor_class !== 'Idefics3Processor'
    || typeof tokenizer.chat_template !== 'string') {
    throw new Error('The cached processor does not match the pinned SmolVLM model.');
  }
  return new Idefics3Processor(processor, {
    tokenizer: new GPT2Tokenizer(tokens, tokenizer),
    image_processor: new Idefics3ImageProcessor(image),
  }, tokenizer.chat_template);
}

export async function readBrowserProcessorJson(file: ProcessorFile): Promise<Record<string, unknown>> {
  const url = processorFileUrl(file);
  // Cache availability is optional. A failed cache write must not block inference.
  const cache = typeof caches === 'undefined'
    ? null : await caches.open('transformers-cache').catch(() => null);
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not download ${file}. Reconnect and try again.`);
    if (cache) await cache.put(url, response.clone()).catch(() => undefined);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid model file: ${file}`);
  }
  return value as Record<string, unknown>;
}
