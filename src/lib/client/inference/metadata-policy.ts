export const METADATA_CATEGORIES = ['hazard', 'fuel-price', 'charging', 'rest-stop', 'vehicle-energy', 'unknown'] as const;
export type MetadataCategory = typeof METADATA_CATEGORIES[number];
export interface MetadataCandidate {
  category: MetadataCategory;
  observedAt: number;
  confidence: number;
  confirmed: boolean;
  relevant: boolean;
}
export const FRESHNESS_MS: Record<MetadataCategory, number> = {
  hazard: 2 * 60_000, 'fuel-price': 2 * 60 * 60_000, charging: 15 * 60_000,
  'rest-stop': 60 * 60_000, 'vehicle-energy': 60_000, unknown: 0,
};

/** Research policy only: model confidence is not calibrated safety probability. */
export function metadataDisposition(candidate: MetadataCandidate, now: number): {
  lane: 'discard' | 'review' | 'personal' | 'routine';
  reason: string;
  automaticDrivingAlert: false;
} {
  const result = (lane: 'discard' | 'review' | 'personal' | 'routine', reason: string) =>
    ({ lane, reason, automaticDrivingAlert: false as const });
  if (!METADATA_CATEGORIES.includes(candidate.category)
    || !Number.isFinite(now) || !Number.isFinite(candidate.observedAt)
    || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1
    || typeof candidate.confirmed !== 'boolean' || typeof candidate.relevant !== 'boolean') {
    return result('discard', 'invalid');
  }
  const age = now - candidate.observedAt;
  if (candidate.category === 'unknown' || age < 0 || age >= FRESHNESS_MS[candidate.category]) {
    return result('discard', 'unknown-or-stale');
  }
  // Neither a user preference nor an LLM-supplied severity may escalate to an alert.
  if (candidate.category === 'hazard' || !candidate.confirmed) return result('review', 'needs-human-review');
  return result(candidate.relevant ? 'personal' : 'routine', 'fresh-confirmed-context');
}
