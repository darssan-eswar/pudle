import { HttpError } from '@/server/http';
import { sha256 } from '@/server/security';

export interface RateLimitStore {
  consumeRateLimit(keyHash: string, limit: number, windowMs: number, now: number): Promise<boolean>;
}

export async function enforceAnalysisRateLimits(
  request: Request,
  userId: string,
  store: RateLimitStore,
  now = Date.now(),
) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const [userAllowed, addressAllowed] = await Promise.all([
    sha256(`analysis:user:${userId}`).then((key) => store.consumeRateLimit(key, 12, 60_000, now)),
    sha256(`analysis:ip:${address}`).then((key) => store.consumeRateLimit(key, 30, 60_000, now)),
  ]);
  if (!userAllowed || !addressAllowed) {
    throw new HttpError(429, 'Too many analysis requests. Try again later.', 'rate_limit');
  }
}
