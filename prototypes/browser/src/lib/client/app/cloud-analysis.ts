import { APP_ENDPOINTS } from './api';
import type { CloudAnalysisErrorCode } from './api';
import { CLOUD_FRAME_MAX_BYTES } from './frame-analysis';
import { notifySessionExpired } from './session-events';

export type CloudAnalysisState =
  | { status: 'unconfigured'; result: null; message: string }
  | {
      status: 'available';
      result: null;
      provider: string;
      model: string;
      message: string;
    }
  | { status: 'processing'; result: null; analysisId: string; startedAt: number }
  | {
      status: 'ready';
      result: {
        summary: string;
        capturedAt: number;
        observations?: string[];
        confidence?: number;
        uncertainty?: string;
        source?: 'cloud-ai';
        model?: string;
        analyzedAt?: number;
      };
      analysisId: string;
    }
  | { status: 'timeout'; result: null; retryable: true; message: string }
  | {
      status: 'quota';
      result: null;
      retryable: boolean;
      retryAfterMs?: number;
      message: string;
    }
  | { status: 'malformed'; result: null; retryable: true; message: string }
  | { status: 'failure'; result: null; retryable: boolean; message: string }
  | { status: 'stale'; result: null; retryable: true; message: string };

export interface CloudAnalysisContext {
  currentAnalysisId?: string;
  currentCaptureStartedAt: number;
  now?: number;
  maxResultAgeMs?: number;
}

export interface CloudAnalysisResult {
  summary: string;
  observations: string[];
  confidence: number;
  uncertainty: string;
  source: 'cloud-ai';
  model: string;
  capturedAt: number;
  analyzedAt: number;
}

export function parseCloudAnalysisAvailability(
  payload: unknown,
): CloudAnalysisState {
  const body = objectValue(payload);
  if (!body || typeof body.configured !== 'boolean') {
    return {
      status: 'unconfigured',
      result: null,
      message: 'Cloud analysis status is unavailable, so uploads remain off.',
    };
  }
  if (!body.configured) {
    return {
      status: 'unconfigured',
      result: null,
      message: 'Cloud analysis is not configured, so uploads remain off.',
    };
  }
  if (
    typeof body.provider !== 'string' ||
    !body.provider.trim() ||
    typeof body.model !== 'string' ||
    !body.model.trim()
  ) {
    return {
      status: 'unconfigured',
      result: null,
      message: 'Cloud analysis status is incomplete, so uploads remain off.',
    };
  }
  return {
    status: 'available',
    result: null,
    provider: body.provider,
    model: body.model,
    message: 'Cloud analysis is configured but remains off until explicit consent.',
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function failureMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/**
 * Converts a future cloud status response into a closed client state. Results
 * are accepted only for the active analysis and current camera capture.
 */
export function parseCloudAnalysisStatus(
  payload: unknown,
  context: CloudAnalysisContext,
): CloudAnalysisState {
  const body = objectValue(payload);
  if (!body || typeof body.status !== 'string') {
    return {
      status: 'malformed',
      result: null,
      retryable: true,
      message: 'Cloud analysis returned an unreadable status.',
    };
  }

  if (body.status === 'unconfigured') {
    return {
      status: 'unconfigured',
      result: null,
      message: 'Cloud analysis is not configured.',
    };
  }

  if (body.status === 'processing') {
    return typeof body.analysisId === 'string' && Number.isFinite(body.startedAt)
      ? {
          status: 'processing',
          result: null,
          analysisId: body.analysisId,
          startedAt: Number(body.startedAt),
        }
      : {
          status: 'malformed',
          result: null,
          retryable: true,
          message: 'Cloud analysis returned an unreadable processing status.',
        };
  }

  if (body.status === 'timeout') {
    return {
      status: 'timeout',
      result: null,
      retryable: true,
      message: failureMessage(body.message, 'Cloud analysis timed out.'),
    };
  }

  if (body.status === 'quota') {
    return {
      status: 'quota',
      result: null,
      retryable: body.retryable !== false,
      retryAfterMs: Number.isFinite(body.retryAfterMs)
        ? Math.max(0, Number(body.retryAfterMs))
        : undefined,
      message: failureMessage(body.message, 'Cloud analysis quota is temporarily unavailable.'),
    };
  }

  if (body.status === 'failure') {
    return {
      status: 'failure',
      result: null,
      retryable: body.retryable === true,
      message: failureMessage(body.message, 'Cloud analysis failed.'),
    };
  }

  if (body.status !== 'ready') {
    return {
      status: 'malformed',
      result: null,
      retryable: true,
      message: 'Cloud analysis returned an unknown status.',
    };
  }

  const analysisId = typeof body.analysisId === 'string' ? body.analysisId : '';
  const capturedAt = Number(body.capturedAt);
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!analysisId || !Number.isFinite(capturedAt) || !summary) {
    return {
      status: 'malformed',
      result: null,
      retryable: true,
      message: 'Cloud analysis returned an incomplete result.',
    };
  }

  const now = context.now ?? Date.now();
  const maxAge = context.maxResultAgeMs ?? 30_000;
  const wrongAnalysis =
    Boolean(context.currentAnalysisId) &&
    analysisId !== context.currentAnalysisId;
  const staleCapture =
    capturedAt < context.currentCaptureStartedAt ||
    capturedAt > now ||
    now - capturedAt > maxAge;
  if (wrongAnalysis || staleCapture) {
    return {
      status: 'stale',
      result: null,
      retryable: true,
      message: 'An older cloud result was discarded.',
    };
  }

  return {
    status: 'ready',
    analysisId,
    result: { summary, capturedAt },
  };
}

export type CloudAnalysisAction =
  | { type: 'request'; analysisId: string; startedAt: number }
  | { type: 'status'; state: CloudAnalysisState }
  | { type: 'reset' };

export function cloudAnalysisReducer(
  state: CloudAnalysisState,
  action: CloudAnalysisAction,
): CloudAnalysisState {
  if (action.type === 'reset') return cloudAnalysisClient.unconfigured();
  if (action.type === 'request') {
    return {
      status: 'processing',
      result: null,
      analysisId: action.analysisId,
      startedAt: action.startedAt,
    };
  }
  // Replacing the complete state prevents an older successful result from
  // surviving a timeout, malformed response, quota response, or failure.
  return action.state;
}

export const cloudAnalysisClient = {
  statusEndpoint: APP_ENDPOINTS.analysis.status,
  submissionEndpoint: APP_ENDPOINTS.analysis.submit,
  unconfigured(): CloudAnalysisState {
    return {
      status: 'unconfigured',
      result: null,
      message: 'Cloud analysis is not configured.',
    };
  },
  async status(): Promise<CloudAnalysisState> {
    try {
      const response = await fetch(this.statusEndpoint, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      notifySessionExpired(response.status);
      if (!response.ok) {
        return {
          status: 'unconfigured',
          result: null,
          message: 'Cloud analysis status is unavailable, so uploads remain off.',
        };
      }
      return parseCloudAnalysisAvailability(await response.json());
    } catch {
      return {
        status: 'unconfigured',
        result: null,
        message: 'Cloud analysis status is unavailable, so uploads remain off.',
      };
    }
  },
  async submitFrame(
    frame: Blob,
    options: {
      capturedAt: number;
      idempotencyKey: string;
      signal: AbortSignal;
      recordingId?: string;
    },
  ): Promise<{ jobId: string; result: CloudAnalysisResult }> {
    if (
      !['image/jpeg', 'image/webp'].includes(frame.type) ||
      frame.size < 1 ||
      frame.size > CLOUD_FRAME_MAX_BYTES
    ) {
      throw new Error('Only compressed JPEG or WebP frames up to 512 KB can be analyzed.');
    }
    const headers: Record<string, string> = {
      'Content-Type': frame.type,
      'X-Pudle-CSRF': '1',
      'X-Pudle-Cloud-Analysis-Consent': 'true',
      'Idempotency-Key': options.idempotencyKey,
      'X-Pudle-Captured-At': String(options.capturedAt),
    };
    if (options.recordingId) headers['X-Pudle-Recording-Id'] = options.recordingId;
    const response = await fetch(this.submissionEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: frame,
      signal: options.signal,
    });
    notifySessionExpired(response.status);
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      code?: CloudAnalysisErrorCode;
      jobId?: string;
      result?: CloudAnalysisResult;
    };
    if (!response.ok) {
      const error = new Error(body.error ?? 'Cloud analysis failed.');
      Object.assign(error, { code: body.code, status: response.status });
      throw error;
    }
    if (!body.jobId || !body.result) {
      const error = new Error('Cloud analysis returned an incomplete result.');
      Object.assign(error, { code: 'malformed_provider_response' });
      throw error;
    }
    return { jobId: body.jobId, result: body.result };
  },
};
