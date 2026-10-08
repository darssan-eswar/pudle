import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

test('runtime UUID factory preserves the Workerd crypto receiver', async (context) => {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-05-22',
    modules: true,
    modulesRoot: process.cwd(),
    scriptPath: fileURLToPath(new URL('./fixtures/workerd-runtime-id.mjs', import.meta.url)),
  });
  context.after(() => miniflare.dispose());

  const response = await miniflare.dispatchFetch('http://pudle.test/');
  assert.equal(response.status, 200);
  const body = await response.json() as { id: string };
  assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
