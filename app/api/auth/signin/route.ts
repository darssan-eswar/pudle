import { getAuthRuntime, enforceRateLimit } from '@/server/auth/runtime';
import { runAuthMutation } from '@/server/auth/route-helpers';

export async function POST(request: Request) {
  const { auth, store, env } = getAuthRuntime();
  return runAuthMutation(
    request,
    { configuredOrigin: env.APP_ORIGIN },
    async (body) => {
      await enforceRateLimit(request, store, 'signin', 10, 15 * 60_000);
      return auth.signIn(body);
    },
  );
}
