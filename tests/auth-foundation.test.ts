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
import { authorizeDemoReset } from '../server/demo';
import { requireMutationOrigin, sha256 } from '../server/security';
import { signedOutResponse } from '../server/auth/route-helpers';

class MemoryAuthStore implements AuthStore {
  users = new Map<string, UserRecord>();
  sessions = new Map<string, SessionRecord>();
  memberships = new Set<string>();
  groupExpiries = new Map<string, number | null>();
  rateLimits = new Map<string, number>();
  failNextSessionWrite = false;

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async createUserWithSession(user: UserRecord, session: SessionRecord) {
    if ([...this.users.values()].some((existing) => existing.email === user.email)) {
      throw new IdentityConflictError();
    }
    if (this.failNextSessionWrite) {
      this.failNextSessionWrite = false;
      throw new Error('session write failed');
    }
    this.users.set(user.id, user);
    this.sessions.set(session.tokenHash, session);
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

  async replaceUserSession(session: SessionRecord) {
    if (this.failNextSessionWrite) {
      this.failNextSessionWrite = false;
      throw new Error('session write failed');
    }
    for (const [key, existing] of this.sessions) {
      if (existing.userId === session.userId) this.sessions.delete(key);
    }
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

  async isGroupMember(userId: string, groupId: string, now: number) {
    const expiresAt = this.groupExpiries.get(groupId);
    return this.memberships.has(`${userId}:${groupId}`)
      && (expiresAt === null || (expiresAt !== undefined && expiresAt > now));
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

test('signup rolls back the user when atomic session creation fails', async () => {
  const { auth, store } = createFixture();
  store.failNextSessionWrite = true;
  await assert.rejects(() => auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  }), /session write failed/);
  assert.equal(store.users.size, 0);
  assert.equal(store.sessions.size, 0);
});

test('concurrent signup attempts preserve one identity and one session', async () => {
  const { auth, store } = createFixture();
  const input = {
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  };
  const results = await Promise.allSettled([auth.signUp(input), auth.signUp(input)]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(store.users.size, 1);
  assert.equal(store.sessions.size, 1);
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
  assert.match(signedOutResponse().headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('failed atomic rotation preserves the previous session', async () => {
  const { auth, store } = createFixture();
  const signup = await auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  });
  store.failNextSessionWrite = true;
  await assert.rejects(() => auth.signIn({
    email: 'driver@example.com',
    password: 'correct horse battery staple',
  }), /session write failed/);
  assert.deepEqual(await auth.currentUser(signup.token), signup.user);
  assert.equal(store.sessions.size, 1);
});

test('concurrent signin rotations leave exactly one active session', async () => {
  const { auth, store } = createFixture();
  await auth.signUp({
    email: 'driver@example.com',
    displayName: 'Driver',
    password: 'correct horse battery staple',
  });
  const credentials = {
    email: 'driver@example.com',
    password: 'correct horse battery staple',
  };
  const sessions = await Promise.all([auth.signIn(credentials), auth.signIn(credentials)]);
  const activeUsers = await Promise.all(sessions.map(({ token }) => auth.currentUser(token)));
  assert.equal(activeUsers.filter(Boolean).length, 1);
  assert.equal(store.sessions.size, 1);
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
  store.groupExpiries.set('group-a', 2_000);
  await requireMembership(store, 'user-a', 'group-a', 1_000);
  await expectHttpError(() => requireMembership(store, 'user-b', 'group-a', 1_000), 403);
  await expectHttpError(() => requireMembership(store, 'user-a', 'group-a', 2_000), 403);
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
  await expectHttpError(
    () => readJsonObject(
      new Request('https://pudle.test/api', {
        method: 'POST',
        headers: { ...headers, 'content-length': '2' },
        body: JSON.stringify({ value: '€'.repeat(20) }),
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

test('demo reset gates mode before rate limiting and rate-limits secret guesses', async () => {
  let attempts = 0;
  const consumeAttempt = async () => {
    attempts += 1;
  };
  await assert.rejects(
    () => authorizeDemoReset({}, null, consumeAttempt),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(attempts, 0);
  await assert.rejects(
    () => authorizeDemoReset(
      { DEMO_MODE: 'true', DEMO_RESET_SECRET: 'reset' },
      'wrong',
      consumeAttempt,
    ),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  assert.equal(attempts, 1);
  const passwords = await authorizeDemoReset({
    DEMO_MODE: 'true',
    DEMO_RESET_SECRET: 'reset',
    DEMO_DRIVER_PASSWORD: 'configured driver password',
    DEMO_PASSENGER_PASSWORD: 'configured passenger password',
  }, 'reset', consumeAttempt);
  assert.equal(passwords.driverPassword, 'configured driver password');
  assert.equal(attempts, 2);
});

test('rate-limit storage rejects requests beyond the configured threshold', async () => {
  const store = new MemoryAuthStore();
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), true);
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), true);
  assert.equal(await store.consumeRateLimit('key', 2, 60_000, 0), false);
});
