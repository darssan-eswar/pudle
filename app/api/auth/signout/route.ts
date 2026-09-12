import { getAuthRuntime, enforceRateLimit } from '@/server/auth/runtime';
import { readSessionCookie } from '@/server/auth/cookies';
import { signedOutResponse } from '@/server/auth/route-helpers';
import { errorResponse } from '@/server/http';
import { requireMutationOrigin } from '@/server/security';

export async function POST(request: Request) {
  try {
    const { auth, store, env } = getAuthRuntime();
    requireMutationOrigin(request, env.APP_ORIGIN);
    await enforceRateLimit(request, store, 'signout', 20, 15 * 60_000);
    await auth.signOut(readSessionCookie(request));
    return signedOutResponse();
  } catch (error) {
    return errorResponse(error);
  }
}
