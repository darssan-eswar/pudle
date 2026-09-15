import { HttpError } from '@/server/http';
import { sha256 } from '@/server/security';
import {
  ANALYSIS_PROVIDER,
  ANALYSIS_LEASE_MS,
  ANALYSIS_RETENTION_MS,
  ANALYSIS_TIMEOUT_MS,
  MIN_FRAME_INTERVAL_MS,
  ProviderFailure,
  type AnalysisJob,
  type AnalysisProvider,
  type AnalysisStore,
  type IdempotentResponse,
} from './contracts';
import { validateFrame, type SupportedImageType } from './image';
import { validateProviderResult } from './validation';

export type AnalyzeInput = {
  userId: string;
  frame: Uint8Array;
  mimeType: SupportedImageType;
  capturedAt: number;
  recordingId?: string;
  idempotencyKey: string;
  optedIn: boolean;
};

function responseForProviderFailure(error: ProviderFailure) {
  if (error.kind === 'timeout') {
    return new HttpError(504, 'Road analysis timed out.', 'provider_timeout');
  }
  if (error.kind === 'quota') {
    return new HttpError(503, 'Road analysis quota is temporarily unavailable.', 'provider_quota');
  }
  if (error.kind === 'malformed') {
    return new HttpError(502, 'Road analysis provider returned malformed output.', 'malformed_provider_response');
  }
  return new HttpError(502, 'Road analysis provider failed.', 'provider_error');
}

function serializeError(error: HttpError) {
  return JSON.stringify({ error: error.message, ...(error.code ? { code: error.code } : {}) });
}

function parseReplay(replay: IdempotentResponse) {
  try {
    return { status: replay.status, body: JSON.parse(replay.body) as unknown, replayed: true };
  } catch {
    throw new HttpError(500, 'Stored idempotency response is invalid.');
  }
}

async function invokeProvider(
  provider: AnalysisProvider,
  frame: Uint8Array,
  mimeType: SupportedImageType,
  timeoutMs: number,
) {
  let lastFailure: ProviderFailure | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await provider.analyze(frame, mimeType, controller.signal);
    } catch (error) {
      const failure = error instanceof ProviderFailure
        ? error
        : new ProviderFailure('provider', 'Analysis provider failed.');
      lastFailure = failure;
      if (failure.kind !== 'provider' || !failure.transient || attempt === 1) throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastFailure ?? new ProviderFailure('provider', 'Analysis provider failed.');
}

export function createAnalysisService(options: {
  store: AnalysisStore;
  provider: AnalysisProvider | null;
  now?: () => number;
  createId?: () => string;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());

  return {
    configured() {
      return {
        configured: options.provider !== null,
        provider: options.provider ? ANALYSIS_PROVIDER : null,
        model: options.provider?.model ?? null,
      };
    },

    async analyze(input: AnalyzeInput) {
      if (!input.optedIn) {
        throw new HttpError(403, 'Explicit cloud-analysis opt-in is required.', 'opt_in_required');
      }
      if (!options.provider) {
        throw new HttpError(503, 'Road analysis is not configured.', 'provider_unconfigured');
      }
      if (!/^[\x21-\x7e]{8,128}$/.test(input.idempotencyKey)) {
        throw new HttpError(400, 'Idempotency-Key must contain 8 to 128 visible ASCII characters.', 'invalid_idempotency_key');
      }
      if (input.recordingId !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(input.recordingId)) {
        throw new HttpError(400, 'Recording id is invalid.', 'invalid_recording_id');
      }
      const timestamp = now();
      if (!Number.isSafeInteger(input.capturedAt)
        || input.capturedAt < timestamp - 5 * 60_000
        || input.capturedAt > timestamp + 30_000) {
        throw new HttpError(400, 'Captured-At must be a recent Unix timestamp in milliseconds.', 'invalid_captured_at');
      }
      validateFrame(input.frame, input.mimeType);

      const keyHash = await sha256(input.idempotencyKey);
      await options.store.cleanupExpired(timestamp);
      const replay = await options.store.getIdempotent(input.userId, keyHash, timestamp);
      if (replay) return parseReplay(replay);

      const job: AnalysisJob = {
        id: createId(),
        userId: input.userId,
        recordingId: input.recordingId ?? null,
        status: 'running',
        provider: ANALYSIS_PROVIDER,
        errorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        leaseExpiresAt: timestamp + ANALYSIS_LEASE_MS,
        completedAt: null,
        expiresAt: timestamp + ANALYSIS_RETENTION_MS,
      };

      if (!await options.store.reserveIdempotency(
        input.userId,
        keyHash,
        job.id,
        timestamp,
        job.expiresAt,
      )) {
        const existing = await options.store.getIdempotent(input.userId, keyHash, timestamp);
        if (existing) return parseReplay(existing);
        throw new HttpError(409, 'An identical analysis request is already in progress.', 'idempotency_in_progress');
      }

      const start = await options.store.startJob(job, timestamp - MIN_FRAME_INTERVAL_MS);
      if (start !== 'started') {
        await options.store.abandonReservation(input.userId, keyHash, job.id);
        if (start === 'recording') {
          throw new HttpError(404, 'Recording metadata was not found.', 'recording_not_found');
        }
        throw new HttpError(
          429,
          start === 'concurrency'
            ? 'Another analysis is already in progress.'
            : 'Frames may be analyzed no more than once every five seconds.',
          start === 'concurrency' ? 'concurrency_limit' : 'cadence_limit',
        );
      }

      try {
        const providerValue = await invokeProvider(
          options.provider,
          input.frame,
          input.mimeType,
          options.timeoutMs ?? ANALYSIS_TIMEOUT_MS,
        );
        const analyzedAt = now();
        const result = validateProviderResult(providerValue, {
          model: options.provider.model,
          capturedAt: input.capturedAt,
          analyzedAt,
        });
        const body = { jobId: job.id, result };
        const responseBody = JSON.stringify(body);
        const completedJob = {
          ...job,
          status: 'completed' as const,
          updatedAt: analyzedAt,
          completedAt: analyzedAt,
        };
        const completed = await options.store.complete(completedJob, result, keyHash, 200, responseBody);
        if (!completed) {
          throw new HttpError(409, 'Analysis processing lease expired.', 'processing_lease_expired');
        }
        return { status: 200, body, replayed: false };
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : error instanceof ProviderFailure
            ? responseForProviderFailure(error)
            : new HttpError(502, 'Road analysis provider failed.', 'provider_error');
        const failedAt = now();
        await options.store.fail(
          { ...job, status: 'failed', updatedAt: failedAt, completedAt: failedAt },
          keyHash,
          httpError.code ?? 'provider_error',
          httpError.status,
          serializeError(httpError),
        );
        throw httpError;
      }
    },
  };
}
