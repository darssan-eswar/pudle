import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { workerSafeImportQuery } from '../scripts/worker-runtime';

test('model dynamic import helper runs without window and preserves URL parts', () => {
  const source = 'import { injectQuery as __vite__injectQuery } from "/@vite/client";';
  const result = workerSafeImportQuery(source, '/repo/node_modules/.vite/deps/@huggingface_transformers.js');
  assert.ok(!result.includes('/@vite/client'));
  const query = runInNewContext(`${result}; __vite__injectQuery`) as (url: string, query: string) => string;
  assert.equal(query('./runtime.mjs?v=1#part', 'import'), './runtime.mjs?v=1&import#part');
  assert.equal(query('/runtime.mjs', 'import'), '/runtime.mjs?import');
  assert.equal(query('https://example.test/runtime.mjs', 'import'), 'https://example.test/runtime.mjs');
  assert.equal(query('blob:worker-runtime', 'import'), 'blob:worker-runtime');
});

test('compatibility transform leaves app HMR and unrelated libraries unchanged', () => {
  const source = 'import { injectQuery as __vite__injectQuery } from "/@vite/client";';
  assert.equal(workerSafeImportQuery(source, '/repo/src/app/app/page.tsx'), source);
  assert.equal(workerSafeImportQuery(source, '/repo/node_modules/other/index.js'), source);
});
