import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@huggingface/transformers', () => ({
  GPT2Tokenizer: class {}, Idefics3ImageProcessor: class {}, Idefics3Processor: class {},
}));
import { processorFileUrl, readBrowserProcessorJson } from './smolvlm-processor';

afterEach(() => vi.unstubAllGlobals());

it('reloads cached processor files without fetching or probing main', async () => {
  const fetch = vi.fn(() => { throw new Error('offline'); });
  const match = vi.fn(async () => new Response('{"cached":true}'));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('caches', { open: async () => ({ match }) });
  expect(await readBrowserProcessorJson('tokenizer_config.json')).toEqual({ cached: true });
  expect(fetch).not.toHaveBeenCalled();
  expect(match).toHaveBeenCalledWith(processorFileUrl('tokenizer_config.json'));
  expect(processorFileUrl('tokenizer_config.json')).not.toContain('/main/');
});

it('downloads only the pinned JSON when cache is missing', async () => {
  const fetch = vi.fn(async () => new Response('{"ok":true}'));
  const put = vi.fn(async () => undefined);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) });
  await readBrowserProcessorJson('tokenizer.json');
  expect(fetch).toHaveBeenCalledWith(processorFileUrl('tokenizer.json'), expect.objectContaining({ credentials: 'omit' }));
  expect(put).toHaveBeenCalledOnce();
});
