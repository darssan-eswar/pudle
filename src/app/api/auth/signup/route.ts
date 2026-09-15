import { getAuthRuntime, enforceRateLimit } from '@/server/auth/runtime';
import { runAuthMutation } from '@/server/auth/route-helpers';

export async function POST(request: Request) {
  const { auth, store, env } = getAuthRuntime();
  return runAuthMutation(
    request,
    { configuredOrigin: env.APP_ORIGIN },
    async (body) => {
      await enforceRateLimit(request, store, 'signup', 5, 15 * 60_000);
      return auth.signUp(body);
    },
    201,
  );
}
