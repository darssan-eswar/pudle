import { METADATA_CATEGORIES, metadataDisposition, type MetadataCategory } from './metadata-policy';

export interface BenchmarkCase {
  id: string;
  tripId: string;
  split: 'train' | 'validation' | 'test';
  expected: MetadataCategory;
  predicted: MetadataCategory;
  relevant: boolean;
  expectedRelevant: boolean;
  confidence: number;
  ageMs: number;
  latencyMs: number;
}

export function scoreMetadataBenchmark(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 10_000) throw new Error('Provide 1–10000 cases.');
  const ids = new Set<string>();
  const trips = new Map<string, string>();
  for (const row of input) {
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) =>
      !['id', 'tripId', 'split', 'expected', 'predicted', 'relevant', 'expectedRelevant', 'confidence', 'ageMs', 'latencyMs'].includes(key))
      || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)
      || typeof row.tripId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.tripId)
      || ids.has(row.id) || !['train', 'validation', 'test'].includes(row.split)
      || !METADATA_CATEGORIES.includes(row.expected) || !METADATA_CATEGORIES.includes(row.predicted)
      || typeof row.relevant !== 'boolean' || typeof row.expectedRelevant !== 'boolean'
      || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1
      || !Number.isFinite(row.ageMs) || row.ageMs < 0
      || !Number.isFinite(row.latencyMs) || row.latencyMs < 0) throw new Error('Invalid or duplicate benchmark case.');
    if (trips.has(row.tripId) && trips.get(row.tripId) !== row.split) throw new Error('Trip leakage across splits.');
    trips.set(row.tripId, row.split); ids.add(row.id);
  }
  const cases = (input as BenchmarkCase[]).filter((row) => row.split === 'test');
  if (!cases.length) throw new Error('No held-out test cases.');
  const latencies = cases.map((row) => row.latencyMs).sort((a, b) => a - b);
  const ratio = (n: number, d: number) => d ? n / d : null;
  const perCategory = Object.fromEntries(METADATA_CATEGORIES.map((category) => {
    const tp = cases.filter((row) => row.expected === category && row.predicted === category).length;
    return [category, {
      support: cases.filter((row) => row.expected === category).length,
      precision: ratio(tp, cases.filter((row) => row.predicted === category).length),
      recall: ratio(tp, cases.filter((row) => row.expected === category).length),
    }];
  }));
  return {
    cases: cases.length, trips: new Set(cases.map((row) => row.tripId)).size,
    categoryAccuracy: cases.filter((row) => row.predicted === row.expected).length / cases.length,
    relevanceAccuracy: cases.filter((row) => row.relevant === row.expectedRelevant).length / cases.length,
    abstentionRate: cases.filter((row) => row.predicted === 'unknown').length / cases.length,
    discardedByPolicy: cases.filter((row) => metadataDisposition({
      category: row.predicted, observedAt: 10 ** 12 - row.ageMs, confidence: row.confidence,
      confirmed: false, relevant: row.relevant,
    }, 10 ** 12).lane === 'discard').length,
    latencyMs: { p50: latencies[Math.ceil(cases.length * 0.5) - 1], p95: latencies[Math.ceil(cases.length * 0.95) - 1] },
    perCategory,
    limitation: 'Scores supplied predictions; does not run a model or measure false alerts/hour, road safety, or phone performance.',
  };
}
