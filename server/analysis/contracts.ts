export const MAX_ANALYSIS_REQUEST_BYTES = 512 * 1024;
export const MAX_FRAME_DIMENSION = 1920;
export const MIN_FRAME_INTERVAL_MS = 5_000;
export const ANALYSIS_RETENTION_MS = 30 * 60 * 1_000;
export const ANALYSIS_TIMEOUT_MS = 8_000;
export const ANALYSIS_LEASE_MS = 30_000;
export const ANALYSIS_PROVIDER = 'google-gemini';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const OBSERVATION_TYPES = [
  'clear-road',
  'road-hazard',
  'collision',
  'flooding',
  'object-on-road',
  'heavy-traffic',
  'parking-available',
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type AnalysisResult = {
  summary: string;
  observations: ObservationType[];
  confidence: number;
  uncertainty: string;
  source: 'cloud-ai';
  model: string;
  capturedAt: number;
  analyzedAt: number;
};

export type ProviderResult = {
  observations: unknown;
  confidence: unknown;
};

export type AnalysisJob = {
  id: string;
  userId: string;
  recordingId: string | null;
  status: 'running' | 'completed' | 'failed';
  provider: string;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  leaseExpiresAt: number;
  completedAt: number | null;
  expiresAt: number;
};

export type IdempotentResponse = { status: number; body: string };

export interface AnalysisStore {
  cleanupExpired(now: number): Promise<void>;
  getIdempotent(userId: string, keyHash: string, now: number): Promise<IdempotentResponse | null>;
  reserveIdempotency(
    userId: string,
    keyHash: string,
    jobId: string,
    now: number,
    expiresAt: number,
  ): Promise<boolean>;
  startJob(
    job: AnalysisJob,
    minimumCreatedAt: number,
  ): Promise<'started' | 'concurrency' | 'cadence' | 'recording'>;
  complete(
    job: AnalysisJob,
    result: AnalysisResult,
    keyHash: string,
    responseStatus: number,
    responseBody: string,
  ): Promise<boolean>;
  fail(
    job: AnalysisJob,
    keyHash: string,
    errorCode: string,
    responseStatus: number,
    responseBody: string,
  ): Promise<void>;
  abandonReservation(userId: string, keyHash: string, jobId: string): Promise<void>;
}

export interface AnalysisProvider {
  readonly model: string;
  analyze(frame: Uint8Array, mimeType: 'image/jpeg' | 'image/webp', signal: AbortSignal): Promise<unknown>;
}

export class ProviderFailure extends Error {
  constructor(
    readonly kind: 'timeout' | 'quota' | 'provider' | 'malformed',
    message: string,
    readonly transient = false,
  ) {
    super(message);
  }
}
