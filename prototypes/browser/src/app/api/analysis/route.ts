import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { D1AnalysisStore } from '@/server/analysis/d1-store';
import { createGeminiProvider } from '@/server/analysis/gemini-provider';
import { readFrameRequest } from '@/server/analysis/image';
import { enforceAnalysisRateLimits } from '@/server/analysis/rate-limit';
import { createAnalysisService } from '@/server/analysis/service';
import { D1AuthStore } from '@/server/auth/d1-store';
import { requireUser } from '@/server/auth/runtime';
import { errorResponse, HttpError, json } from '@/server/http';
import { requireMutationOrigin } from '@/server/security';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request, env.APP_ORIGIN);
    const user = await requireUser(request);
    const d1 = getD1();
    await enforceAnalysisRateLimits(request, user.id, new D1AuthStore(d1));

    const idempotencyKey = request.headers.get('idempotency-key') ?? '';
    const capturedAt = Number(request.headers.get('x-pudle-captured-at'));
    const recordingId = request.headers.get('x-pudle-recording-id') ?? undefined;
    const optedIn = request.headers.get('x-pudle-cloud-analysis-consent') === 'true';
    if (!optedIn) {
      throw new HttpError(403, 'Explicit cloud-analysis opt-in is required.', 'opt_in_required');
    }
    const provider = createGeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    if (!provider) {
      throw new HttpError(503, 'Road analysis is not configured.', 'provider_unconfigured');
    }
    const { frame, mimeType } = await readFrameRequest(request);

    const service = createAnalysisService({
      store: new D1AnalysisStore(d1),
      provider,
    });
    const response = await service.analyze({
      userId: user.id,
      frame,
      mimeType,
      capturedAt,
      recordingId,
      idempotencyKey,
      optedIn,
    });
    return json(response.body, response.status, response.replayed ? { 'Idempotency-Replayed': 'true' } : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}
