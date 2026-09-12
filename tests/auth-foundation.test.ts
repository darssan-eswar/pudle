import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IdentityConflictError,
  type AuthStore,
  type SessionRecord,
  type UserRecord,
} from '../server/auth/contracts';
import { createAuthService } from '../server/auth/service';
import { requireAuthenticatedUser, requireMembership } from '../server/auth/authorization';
import { HttpError, readJsonObject } from '../server/http';
import { requireDemoReset } from '../server/demo';
import { requireMutationOrigin, sha256 } from '../server/security';

class MemoryAuthStore implements AuthStore {
  users = new Map<string, UserRecord>();
  sessions = new Map<string, SessionRecord>();
  memberships = new Set<string>();
  rateLimits = new Map<string, number>();

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async createUser(user: UserRecord) {
    if (await this.findUserByEmail(user.email)) throw new IdentityConflictError();
    this.users.set(user.id, user);
  }

  async upsertDemoUser(user: UserRecord) {
    const existing = await this.findUserByEmail(user.email);
    if (existing) this.users.delete(existing.id);
    this.users.set(user.id, user);
  }

  async findSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    const user = session ? this.users.get(session.userId) : null;
    return session && user
      ? {
          session,
          user: { id: user.id, email: user.email, displayName: user.displayName },
        }
      : null;
  }

  async createSession(session: SessionRecord) {
    this.sessions.set(session.tokenHash, session);
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async deleteUserSessions(userId: string) {
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(key);
    }
  }

  async consumeRateLimit(keyHash: string, limit: number, windowMs: number, now: number) {
    void windowMs;
    void now;
    const count = (this.rateLimits.get(keyHash) ?? 0) + 1;
    this.rateLimits.set(keyHash, count);
    return count <= limit;
  }

  async cleanupExpired(now: number) {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }

  async isGroupMember(userId: string, groupId: string) {
    return this.memberships.has(`${userId}:${groupId}`);
  }
}

function createFixture(now = 1_700_000_000_000) {
  const store = new MemoryAuthStore();
  let id = 0;
  return {
    store,
    auth: createAuthService({
      store,
      now: () => now,
      createId: () => `id-${++id}`,
    }),
  };
}

async function expectHttpError(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, (error: unknown) => error instanceof HttpError && error.status === status);
}

test('signup normalizes identity and creates a real session', async () => {
  const { auth, store } = createFixture();
  const result = await auth.signUp({
    email: '  Driver@Example.COM ',
    displayName: ' Demo   Driver ',
    password: 'correct horse battery staple',
  });

  assert.deepEqual(result.user, {
    id: 'id-1',
    email: 'driver@example.com',
    displayName: 'Demo Driver',
  });
  assert.equal(store.sessions.size, 1);
  assert.deepEqual(await auth.currentUser(result.token), result.user);
  assert.equal([...store.sessions.keys()][0], await sha256(result.token));
  assert.equal([...store.sessions.keys()][0] === result.token, false);
});

test('duplicate normalized email is rejected', async () => {
  const { auth } = createFixture();
  const input = {
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  };
  await auth.signUp(input);
  await expectHttpError(
    () => auth.signUp({ ...input, email: ' DRIVER@example.com ' }),
    409,
  );
});

test('signin rotates sessions and signout invalidates the current token', async () => {
  const { auth, store } = createFixture();
  const signup = await auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  });
  const signin = await auth.signIn({
    email: 'driver@example.com',
    password: 'correct horse battery staple',
  });

  assert.notEqual(signin.token, signup.token);
  assert.equal(await auth.currentUser(signup.token), null);
  assert.equal(store.sessions.size, 1);
  await auth.signOut(signin.token);
  assert.equal(await auth.currentUser(signin.token), null);
});

test('signin uses the same generic error for unknown accounts and wrong passwords', async () => {
  const { auth } = createFixture();
  await auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  });

  const errors: string[] = [];
  for (const credentials of [
    { email: 'driver@example.com', password: 'incorrect password' },
    { email: 'unknown@example.com', password: 'incorrect password' },
  ]) {
    await assert.rejects(
      () => auth.signIn(credentials),
      (error: unknown) => {
        if (error instanceof HttpError) errors.push(error.message);
        return error instanceof HttpError && error.status === 401;
      },
    );
  }
  assert.deepEqual(errors, ['Invalid email or password.', 'Invalid email or password.']);
});

test('expired and anonymous sessions are rejected', async () => {
  let now = 1_700_000_000_000;
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, now: () => now });
  const signup = await auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  });
  await expectHttpError(() => requireAuthenticatedUser(auth, null), 401);
  now += 8 * 24 * 60 * 60 * 1_000;
  await expectHttpError(() => requireAuthenticatedUser(auth, signup.token), 401);
  assert.equal(store.sessions.size, 0);
});

test('authorization primitives isolate users from groups they do not belong to', async () => {
  const store = new MemoryAuthStore();
  store.memberships.add('user-a:group-a');
  await requireMembership(store, 'user-a', 'group-a');
  await expectHttpError(() => requireMembership(store, 'user-b', 'group-a'), 403);
});

test('JSON parser rejects invalid shape and oversized bodies', async () => {
  const headers = { 'content-type': 'application/json' };
  await expectHttpError(
    () => readJsonObject(new Request('https://pudle.test/api', { method: 'POST', headers, body: '[]' })),
    400,
  );
  await expectHttpError(
    () => readJsonObject(
      new Request('https://pudle.test/api', {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: 'x'.repeat(100) }),
      }),
      32,
    ),
    413,
  );
});

test('mutation origin and CSRF header are both required', () => {
  const valid = new Request('https://pudle.test/api/auth/signin', {
    method: 'POST',
    headers: { origin: 'https://pudle.test', 'x-pudle-csrf': '1' },
  });
  requireMutationOrigin(valid);
  assert.throws(
    () => requireMutationOrigin(new Request(valid.url, { method: 'POST', headers: { origin: 'https://evil.test', 'x-pudle-csrf': '1' } })),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => requireMutationOrigin(new Request(valid.url, { method: 'POST', headers: { origin: 'https://pudle.test' } })),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test('demo reset requires explicit mode, secret, and account passwords', () => {
  assert.throws(
    () => requireDemoReset({}, null),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.throws(
    () => requireDemoReset({ DEMO_MODE: 'true', DEMO_RESET_SECRET: 'reset' }, 'wrong'),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  const passwords = requireDemoReset({
    DEMO_MODE: 'true',
    DEMO_RESET_SECRET: 'reset',
    DEMO_DRIVER_PASSWORD: 'configured driver password',
    DEMO_PASSENGER_PASSWORD: 'configured passenger password',
  }, 'reset');
  assert.equal(passwords.driverPassword, 'configured driver password');
});

test('rate-limit storage rejects requests beyond the configured threshold', async () => {
  const store = new MemoryAuthStore();
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), true);
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), true);
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), false);
});
