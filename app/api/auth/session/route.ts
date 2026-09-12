import { getAuthRuntime } from '@/server/auth/runtime';
import { readSessionCookie } from '@/server/auth/cookies';
import { errorResponse, json } from '@/server/http';

export async function GET(request: Request) {
  try {
    const { auth, store } = getAuthRuntime();
    await store.cleanupExpired(Date.now());
    const user = await auth.currentUser(readSessionCookie(request));
    return json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
