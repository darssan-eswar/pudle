import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHazardRow } from '../src/core/events';
import { offset, distance, bearing } from '../src/core/geo';
import { cameraPrompt, phraseFor, spokenDistance } from '../src/core/phrases';
import { AlertPolicy, DetectionFilter } from '../src/core/policy';
import { evaluate, estimateCourse, RoadCorridor, type Point } from '../src/core/relevance';
import type { HazardEvent, HazardLocation, ReceiverFix } from '../src/core/types';

const now = Date.parse('2026-10-07T19:06:40Z');
const convoy = '6b0c1f8e-1d1b-4c4e-9c55-2f8a0d9e3a11';
const base: [number, number] = [35.2271, -80.8431];
const iso = (o: number) => new Date(now + o * 1000).toISOString();

function row(extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(), schema_version: 1, convoy_id: convoy, reporter_id: 'a', kind: 'tree',
    source: 'convoy_member', side: 'right', blocks_road: false,
    observed_at: iso(-10), created_at: iso(-5), expires_at: iso(895), ...extra,
  };
}
function fix(p: [number, number] = base, course: number | null = 0, speed = 20, acc = 8, ageS = 1): ReceiverFix {
  return { latitude: p[0], longitude: p[1], accuracyMeters: acc, courseDegrees: course, speedMps: speed, timestamp: now - ageS * 1000 };
}
function hazard(meters: number, brg: number, heading: number | null = 0, acc = 10, from = base): HazardLocation {
  const [lat, lon] = offset(from[0], from[1], meters, brg);
  return { latitude: lat, longitude: lon, accuracyMeters: acc, headingDegrees: heading };
}
function event(extra: Partial<HazardEvent> = {}): HazardEvent {
  return { id: crypto.randomUUID(), kind: 'debris', source: 'convoy_member', side: 'unknown', blocksRoad: false,
           reporterId: 'alice', observedAt: now - 2000, createdAt: now - 2000, expiresAt: now + 118_000, ...extra };
}

test('rows: valid camera row keeps side and blockage; bad rows rejected', () => {
  const ok = parseHazardRow(row({ source: 'driver_confirmed_camera', latitude: 35, longitude: -80, accuracy_m: 12, heading_deg: 90, side: 'left', blocks_road: true }), convoy, now);
  assert.ok(ok.ok && ok.event.side === 'left' && ok.event.blocksRoad);
  const reason = (r: object) => { const x = parseHazardRow(r, convoy, now); return x.ok ? null : x.reason; };
  assert.equal(reason(row({ kind: 'say turn left now' })), 'unknownKind');
  assert.equal(reason(row({ source: 'labeled_test' })), 'unknownSource');
  assert.equal(reason(row({ source: 'driver_confirmed_camera' })), 'invalidLocation');
  assert.equal(reason(row({ latitude: 35, longitude: null, accuracy_m: 12 })), 'invalidLocation');
  assert.equal(reason(row({ latitude: 95, longitude: -80, accuracy_m: 12 })), 'invalidLocation');
  assert.equal(reason(row({ side: 'upward' })), 'malformed');
  assert.equal(reason(row({ convoy_id: crypto.randomUUID() })), 'wrongConvoy');
  assert.equal(reason(row({ id: 'x'.repeat(5000) })), 'malformed');
  assert.equal(reason(row({ created_at: iso(-200), observed_at: iso(-200), expires_at: iso(-10) })), 'expired');
  assert.equal(reason(row({ created_at: iso(120), observed_at: iso(120), expires_at: iso(300) })), 'createdInFuture');
  assert.equal(reason(row({ expires_at: iso(4000) })), 'lifetimeTooLong');
});

test('heading rules: ahead, opposite, passed, parallel, stationary, stale', () => {
  const ahead = evaluate(hazard(800, 0), fix(), now);
  assert.equal(ahead.type, 'ahead');
  assert.equal(evaluate(hazard(800, 0, 180), fix(), now).type, 'notRelevant');
  assert.deepEqual(evaluate(hazard(300, 180), fix(), now), { type: 'notRelevant', why: 'behind or passed' });
  const side = offset(base[0], base[1], 120, 90);
  assert.notEqual(evaluate(hazard(400, 0, 0, 10, side), fix(), now).type, 'ahead');
  assert.equal(evaluate(hazard(200, 0), fix(base, null, 0), now).type, 'nearby');
  assert.deepEqual(evaluate(hazard(500, 0), fix(base, 0, 20, 8, 60), now), { type: 'receiverUnknown', why: 'stale position' });
  assert.equal(evaluate(null, fix(), now).type, 'unlocated');
});

function road(): RoadCorridor {
  const pts: Point[] = [base];
  let p = base;
  for (let i = 0; i < 30; i++) { p = offset(p[0], p[1], 50, 0); pts.push(p); }
  for (let i = 0; i < 30; i++) { p = offset(p[0], p[1], 50, 45); pts.push(p); }
  return RoadCorridor.create('c', 'Demo road', pts)!;
}
function along(m: number): [number, number] {
  const c = road();
  let rem = m;
  for (let i = 0; i < c.points.length - 1; i++) {
    const [a, b] = [c.points[i], c.points[i + 1]];
    const d = distance(a[0], a[1], b[0], b[1]);
    if (rem <= d) return offset(a[0], a[1], rem, bearing(a[0], a[1], b[0], b[1]));
    rem -= d;
  }
  return c.points[c.points.length - 1];
}
const onRoad = (m: number, sideways = 6): HazardLocation => {
  const p = along(m); const q = offset(p[0], p[1], sideways, 90);
  return { latitude: q[0], longitude: q[1], accuracyMeters: 10, headingDegrees: 0 };
};
const car = (m: number, course: number, speed = 8, sideways = 0) => {
  let p = along(m); if (sideways) p = offset(p[0], p[1], Math.abs(sideways), sideways > 0 ? 90 : 270);
  return fix(p, course, speed);
};

test('corridor: distance along a bend, one-mile window, opposite, passed, parallel, slow', () => {
  const r = evaluate(onRoad(2400), car(1000, 0), now, road());
  assert.ok(r.type === 'ahead' && Math.abs(r.meters - 1400) < 15 && r.onRecordedRoad);
  assert.deepEqual(evaluate(onRoad(2900), car(500, 0), now, road()), { type: 'notRelevant', why: 'not yet in range' });
  assert.deepEqual(evaluate(onRoad(1200), car(600, 180), now, road()), { type: 'notRelevant', why: 'opposite direction' });
  assert.deepEqual(evaluate(onRoad(400), car(900, 0), now, road()), { type: 'notRelevant', why: 'behind or passed' });
  assert.deepEqual(evaluate(onRoad(1200), car(800, 0, 8, 150), now, road()), { type: 'notRelevant', why: 'off the recorded road' });
  assert.equal(evaluate(onRoad(1000), car(600, 0, 1.5), now, road()).type, 'ahead');
});

test('course estimate from slow fixes', () => {
  const fixes = [0, 1, 2, 3, 4, 5].map((i) => {
    const p = offset(base[0], base[1], i * 4, 30);
    return { latitude: p[0], longitude: p[1], accuracyMeters: 6, courseDegrees: null, speedMps: 1, timestamp: now + i * 2000 };
  });
  assert.ok(Math.abs(estimateCourse(fixes)! - 30) < 1);
  assert.equal(estimateCourse(fixes.slice(0, 2)), null);
});

test('phrases: only ahead says ahead; blockage is possible; camera prompt', () => {
  for (const rel of [{ type: 'unlocated' }, { type: 'receiverUnknown', why: 'x' }, { type: 'nearby', meters: 200 }] as const) {
    const t = phraseFor(event(), rel, 'imperial')!;
    assert.doesNotMatch(t, /ahead|feet|mile/i);
    assert.match(t, /reported/);
  }
  const cam = event({ source: 'driver_confirmed_camera', kind: 'object', side: 'right' });
  assert.equal(phraseFor(cam, { type: 'ahead', meters: 1609, onRecordedRoad: true }, 'imperial'),
    'Heads up. Something on the right side of the road, about a mile ahead, reported by a Pudle driver.');
  const block = event({ source: 'driver_confirmed_camera', kind: 'tree', blocksRoad: true });
  assert.equal(phraseFor(block, { type: 'ahead', meters: 800, onRecordedRoad: true }, 'imperial', 'buddy'),
    'Yo, heads up. Possible road blockage about half a mile ahead: a fallen branch, reported by a Pudle driver. You might want to reroute.');
  assert.equal(phraseFor(event(), { type: 'notRelevant', why: 'far' }, 'imperial'), null);
  assert.match(cameraPrompt('object', 'right', false, 'copilot'), /^Heads up\. Possible object on the right side of the road coming up/);
  assert.equal(spokenDistance(150, 'imperial'), 'about 500 feet');
  assert.equal(spokenDistance(2300, 'metric'), 'about 2.5 kilometers');
});

test('policy: once only, mute does not replay, own report silent, far report spoken later, rate limit not lost', () => {
  const p = new AlertPolicy(); p.active = true; p.ownUserId = 'bob';
  const e = event();
  assert.equal(p.decide(e, null, now).type, 'speak');
  assert.deepEqual(p.decide(e, null, now + 3), { type: 'suppress', reason: 'duplicate', final: true });
  assert.equal((p.decide(event({ reporterId: 'bob', kind: 'tree' }), null, now) as any).reason, 'your own report');

  const far = event({ kind: 'animal', location: hazard(2600, 0) });
  assert.equal((p.decide(far, fix(), now) as any).final, false);
  const closer = offset(base[0], base[1], 1200, 0);
  const later = { ...fix(closer), timestamp: now + 29_000 };
  const d = p.decide(far, later, now + 30_000);
  assert.ok(d.type === 'speak' && d.relevance.type === 'ahead' && Math.abs(d.relevance.meters - 1400) < 5);

  const q = new AlertPolicy(); q.active = true; q.muted = true;
  const m = event();
  assert.equal((q.decide(m, null, now) as any).reason, 'muted (not replayed)');
  q.muted = false;
  assert.equal((q.decide(m, null, now + 1) as any).reason, 'duplicate');

  const r = new AlertPolicy(); r.active = true; r.maxPerMinute = 1;
  assert.equal(r.decide(event({ kind: 'tree' }), null, now).type, 'speak');
  const later2 = event({ kind: 'pothole' });
  assert.equal((r.decide(later2, null, now + 1000) as any).reason, 'rate limited');
  assert.equal(r.decide(later2, null, now + 61_000).type, 'speak');
});

test('detection filter: two agreeing frames, cooldown, low confidence ignored', () => {
  const f = new DetectionFilter();
  assert.equal(f.add({ kind: 'tree', side: 'right', blocksRoad: false, confidence: 0.7, at: now }, now), null);
  const hit = f.add({ kind: 'debris', side: 'right', blocksRoad: true, confidence: 0.75, at: now + 1000 }, now + 1000);
  assert.equal(hit?.kind, 'debris');
  assert.equal(hit?.blocksRoad, true);
  assert.equal(f.add({ kind: 'tree', side: 'right', blocksRoad: false, confidence: 0.95, at: now + 5000 }, now + 5000), null);
  assert.ok(f.add({ kind: 'tree', side: 'left', blocksRoad: false, confidence: 0.95, at: now + 40_000 }, now + 40_000));
  const g = new DetectionFilter();
  assert.equal(g.add({ kind: 'tree', side: 'right', blocksRoad: false, confidence: 0.3, at: now }, now), null);
});
