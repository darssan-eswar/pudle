import { env } from 'cloudflare:workers';
import { getAuthRuntime, enforceRateLimit } from '@/server/auth/runtime';
import { errorResponse, json } from '@/server/http';
import { requireMutationOrigin } from '@/server/security';
import { requireDemoReset } from '@/server/demo';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request, env.APP_ORIGIN);
    const passwords = requireDemoReset(env, request.headers.get('x-demo-reset-secret'));
    const { auth, store } = getAuthRuntime();
    await enforceRateLimit(request, store, 'demo-reset', 3, 60 * 60_000);
    const accounts = await auth.seedDemoUsers(passwords.driverPassword, passwords.passengerPassword);
    return json({ accounts });
  } catch (error) {
    return errorResponse(error);
  }
}
