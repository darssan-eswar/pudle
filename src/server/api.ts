import { getD1 } from '@/db';
import { D1AuthStore } from '@/server/auth/d1-store';
import { createAuthService } from '@/server/auth/service';
import { readSessionCookie } from '@/server/auth/cookies';
import { requireAuthenticatedUser } from '@/server/auth/authorization';
import { HttpError } from '@/server/http';
import { requireMutationOrigin, sha256 } from '@/server/security';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~-]{8,128}$/;

export async function authenticatedContext(request: Request, action: string, limit = 60) {
  const d1 = getD1();
  const store = new D1AuthStore(d1);
  const auth = createAuthService({ store });
  const user = await requireAuthenticatedUser(auth, readSessionCookie(request));
  const keyHash = await sha256(`${action}:${user.id}`);
  if (!await store.consumeRateLimit(keyHash, limit, 60_000, Date.now())) {
    throw new HttpError(429, 'Too many requests. Try again later.');
  }
  await store.cleanupExpired(Date.now());
  return { d1, store, user };
}

export function requireMutation(request: Request, configuredOrigin?: string) {
  requireMutationOrigin(request, configuredOrigin);
}

export function requireIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key');
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new HttpError(400, 'A valid Idempotency-Key header is required.');
  }
  return value;
}

export function requireIdentifier(value: string, label = 'identifier') {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}
