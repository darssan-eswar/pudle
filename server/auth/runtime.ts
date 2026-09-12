import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { HttpError } from '@/server/http';
import { sha256 } from '@/server/security';
import { D1AuthStore } from './d1-store';
import { createAuthService } from './service';
import { readSessionCookie } from './cookies';
import { requireAuthenticatedUser, requireMembership } from './authorization';

export function getAuthRuntime() {
  const store = new D1AuthStore(getD1());
  return { store, auth: createAuthService({ store }), env };
}

export async function enforceRateLimit(
  request: Request,
  store: D1AuthStore,
  action: string,
  limit = 10,
  windowMs = 60_000,
) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const keyHash = await sha256(`${action}:${address}`);
  if (!await store.consumeRateLimit(keyHash, limit, windowMs, Date.now())) {
    throw new HttpError(429, 'Too many requests. Try again later.');
  }
}

export async function requireUser(request: Request) {
  const { auth } = getAuthRuntime();
  return requireAuthenticatedUser(auth, readSessionCookie(request));
}

export async function requireGroupMember(request: Request, groupId: string) {
  const { store } = getAuthRuntime();
  const user = await requireUser(request);
  await requireMembership(store, user.id, groupId);
  return user;
}
