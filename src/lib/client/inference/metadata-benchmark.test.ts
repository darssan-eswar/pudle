import { expect, it } from 'vitest';
import { metadataDisposition } from './metadata-policy';
import { scoreMetadataBenchmark } from './metadata-benchmark';
const sample = { id: 'a', tripId: 'trip1', split: 'test', expected: 'hazard', predicted: 'hazard', relevant: true, expectedRelevant: true, confidence: 0.9, ageMs: 0, latencyMs: 40 };

it('keeps personal importance and model claims out of automatic safety alerts', () => {
  const candidate = { category: 'fuel-price' as const, observedAt: 1_000, confidence: 1, confirmed: true, relevant: true };
  expect(metadataDisposition(candidate, 1_100)).toMatchObject({ lane: 'personal', automaticDrivingAlert: false });
  expect(metadataDisposition({ ...candidate, category: 'hazard' }, 1_100).lane).toBe('review');
  expect(metadataDisposition(candidate, 10_000_000).lane).toBe('discard');
  expect(metadataDisposition({ ...candidate, confidence: NaN }, 1_100).lane).toBe('discard');
});

it('scores held-out predictions and rejects duplicate IDs and trip leakage', () => {
  expect(scoreMetadataBenchmark([sample])).toMatchObject({ categoryAccuracy: 1, latencyMs: { p50: 40, p95: 40 } });
  expect(() => scoreMetadataBenchmark([sample, sample])).toThrow();
  expect(() => scoreMetadataBenchmark([sample, { ...sample, id: 'b', split: 'train' }])).toThrow('Trip leakage');
  expect(() => scoreMetadataBenchmark([{ ...sample, confidence: NaN }])).toThrow();
});
