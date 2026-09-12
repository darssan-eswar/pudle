import { getAuthRuntime } from '@/server/auth/runtime';
import { readSessionCookie } from '@/server/auth/cookies';
import { signedOutResponse } from '@/server/auth/route-helpers';
import { errorResponse } from '@/server/http';
import { requireMutationOrigin } from '@/server/security';

export async function POST(request: Request) {
  try {
    const { auth, env } = getAuthRuntime();
    requireMutationOrigin(request, env.APP_ORIGIN);
    await auth.signOut(readSessionCookie(request));
    return signedOutResponse();
  } catch (error) {
    return errorResponse(error);
  }
}
