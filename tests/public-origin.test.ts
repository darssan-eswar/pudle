import assert from 'node:assert/strict';
import test from 'node:test';
import { publicOrigin } from '../src/server/public-origin';

test('canonical origin uses configured HTTPS origin and strips paths', () => {
  assert.equal(publicOrigin('https://pudle.vercel.app/app?q=1').href, 'https://pudle.vercel.app/');
  assert.equal(publicOrigin('http://localhost:4173').href, 'http://localhost:4173/');
});

test('canonical origin rejects invalid, credential-bearing, and insecure public URLs', () => {
  const fallback = 'https://pulzar-road-intelligence.ledarssan919276.chatgpt.site/';
  for (const input of [undefined, 'not-a-url', 'javascript:alert(1)', 'http://public.example', 'https://user:secret@example.com']) {
    assert.equal(publicOrigin(input).href, fallback);
  }
});
