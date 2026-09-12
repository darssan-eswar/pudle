import { HttpError } from '@/server/http';
import {
  OBSERVATION_TYPES,
  type AnalysisResult,
  type ObservationType,
  type ProviderResult,
} from './contracts';

const observationTypes = new Set<string>(OBSERVATION_TYPES);

const observationSummaries: Record<ObservationType, string> = {
  'clear-road': 'The road appears clear.',
  'road-hazard': 'A road hazard is visible.',
  collision: 'A collision is visible.',
  flooding: 'Flooding is visible.',
  'object-on-road': 'An object is visible on the road.',
  'heavy-traffic': 'Heavy traffic is visible.',
  'parking-available': 'Parking appears available.',
};

export function validateProviderResult(
  value: unknown,
  metadata: Pick<AnalysisResult, 'model' | 'capturedAt' | 'analyzedAt'>,
): AnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, 'Analysis provider returned malformed output.', 'malformed_provider_response');
  }
  const candidate = value as ProviderResult & Record<string, unknown>;
  const allowedKeys = new Set(['observations', 'confidence']);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(502, 'Analysis provider returned unexpected fields.', 'malformed_provider_response');
  }
  if (!Array.isArray(candidate.observations) || candidate.observations.length > 5
    || candidate.observations.some((item) => typeof item !== 'string' || !observationTypes.has(item))) {
    throw new HttpError(502, 'Analysis provider returned invalid observations.', 'malformed_provider_response');
  }
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)
    || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new HttpError(502, 'Analysis provider returned invalid confidence.', 'malformed_provider_response');
  }
  const observations = [...new Set(candidate.observations)] as ObservationType[];
  return {
    summary: observations.length === 0
      ? 'No supported road condition was identified.'
      : observations.map((observation) => observationSummaries[observation]).join(' '),
    observations,
    confidence: candidate.confidence,
    uncertainty: candidate.confidence >= 0.8
      ? 'Model confidence is high; conditions may still change.'
      : candidate.confidence >= 0.5
        ? 'Model confidence is moderate; verify the road conditions.'
        : 'Model confidence is low; do not rely on this analysis.',
    source: 'cloud-ai',
    model: metadata.model,
    capturedAt: metadata.capturedAt,
    analyzedAt: metadata.analyzedAt,
  };
}
