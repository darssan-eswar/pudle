import assert from 'node:assert/strict';
import test from 'node:test';
import { alertCopy, isFreshReport, parseReport } from '../src/lib/obstacles';
import type { ObstacleReport } from '../src/lib/obstacles';

const now = Date.parse('2026-09-25T12:00:00.000Z');
const report: ObstacleReport = {
  id: 'r1', convoy_id: 'c1', reporter_id: 'u1', kind: 'tree',
  created_at: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + 119000).toISOString(),
};

test('only known report kinds and parseable timestamps are accepted', () => {
  assert.deepEqual(parseReport(report), report);
  assert.equal(parseReport({ ...report, kind: 'untrusted spoken text' }), null);
  assert.equal(parseReport({ ...report, created_at: 'not-a-date' }), null);
});

test('old and expired reports never qualify for a new alert', () => {
  assert.equal(isFreshReport(report, now), true);
  assert.equal(isFreshReport(report, now + 121000), false);
  assert.equal(isFreshReport({ ...report, created_at: new Date(now - 130000).toISOString() }, now), false);
});

test('speech uses fixed copy and does not claim a position or distance', () => {
  assert.match(alertCopy('tree'), /Tree or branch in road/);
  assert.doesNotMatch(alertCopy('tree'), /ahead|mile|feet/i);
});
