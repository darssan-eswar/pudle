import { clearSessionCookie, sessionCookie } from './cookies';
import { errorResponse, json, readJsonObject } from '../http';
import { requireMutationOrigin } from '../security';

export type AuthRouteContext = {
  configuredOrigin?: string;
};

export async function runAuthMutation(
  request: Request,
  context: AuthRouteContext,
  handler: (body: Record<string, unknown>) => Promise<{ user: unknown; token: string }>,
  successStatus = 200,
) {
  try {
    requireMutationOrigin(request, context.configuredOrigin);
    const body = await readJsonObject(request);
    const result = await handler(body);
    return json({ user: result.user }, successStatus, { 'Set-Cookie': sessionCookie(result.token) });
  } catch (error) {
    return errorResponse(error);
  }
}

export function signedOutResponse() {
  return json({ signedOut: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
