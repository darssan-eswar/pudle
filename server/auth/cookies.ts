import { SESSION_COOKIE, SESSION_TTL_MS } from './contracts';

const LOCAL_SESSION_COOKIE = 'pudle_session_local';

function isLoopbackHttp(request?: Request) {
  if (!request) return false;

  const url = new URL(request.url);
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';

  return url.protocol === 'http:' && isLoopback;
}

function sessionCookieName(request?: Request) {
  return isLoopbackHttp(request) ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
}

export function readSessionCookie(request: Request) {
  const expectedName = sessionCookieName(request);
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === expectedName) return value.join('=') || null;
  }
  return null;
}

function secureAttribute(request?: Request) {
  return isLoopbackHttp(request) ? '' : '; Secure';
}

export function sessionCookie(token: string, request?: Request) {
  return `${sessionCookieName(request)}=${token}; Path=/; HttpOnly${secureAttribute(request)}; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`;
}

export function clearSessionCookie(request?: Request) {
  return `${sessionCookieName(request)}=; Path=/; HttpOnly${secureAttribute(request)}; SameSite=Strict; Max-Age=0`;
}
