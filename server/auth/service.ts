import {
  SESSION_TTL_MS,
  type AuthStore,
  IdentityConflictError,
  type PublicUser,
  type UserRecord,
} from './contracts';
import { createOpaqueToken, hashPassword, sha256, verifyPassword } from '../security';
import { HttpError } from '../http';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$310000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export type AuthDependencies = {
  store: AuthStore;
  now?: () => number;
  createId?: () => string;
};

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid account details.');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'Invalid account details.');
  }
  return email;
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid account details.');
  const displayName = value.trim().replace(/\s+/g, ' ');
  if (displayName.length < 1 || displayName.length > 60) {
    throw new HttpError(400, 'Invalid account details.');
  }
  return displayName;
}

function validatePassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new HttpError(400, 'Password must be between 12 and 128 characters.');
  }
  return value;
}

function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export function createAuthService({ store, now = Date.now, createId = crypto.randomUUID.bind(crypto) }: AuthDependencies) {
  async function buildSession(userId: string) {
    const token = createOpaqueToken();
    const tokenHash = await sha256(token);
    const timestamp = now();
    const session = {
      id: createId(),
      userId,
      tokenHash,
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + SESSION_TTL_MS,
    };
    return { token, session };
  }

  return {
    async signUp(input: Record<string, unknown>) {
      const email = normalizeEmail(input.email);
      const displayName = normalizeDisplayName(input.displayName);
      const password = validatePassword(input.password);
      if (await store.findUserByEmail(email)) {
        throw new HttpError(409, 'An account with that email already exists.');
      }
      const timestamp = now();
      const user: UserRecord = {
        id: createId(),
        email,
        displayName,
        passwordHash: await hashPassword(password),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const issued = await buildSession(user.id);
      try {
        await store.createUserWithSession(user, issued.session);
      } catch (error) {
        if (error instanceof IdentityConflictError) {
          throw new HttpError(409, 'An account with that email already exists.');
        }
        throw error;
      }
      return { user: publicUser(user), token: issued.token };
    },

    async signIn(input: Record<string, unknown>) {
      const email = normalizeEmail(input.email);
      const password = typeof input.password === 'string' && input.password.length <= 128
        ? input.password
        : '';
      const user = await store.findUserByEmail(email);
      const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        throw new HttpError(401, 'Invalid email or password.');
      }
      const issued = await buildSession(user.id);
      await store.replaceUserSession(issued.session);
      return { user: publicUser(user), token: issued.token };
    },

    async currentUser(token: string | null) {
      if (!token) return null;
      const tokenHash = await sha256(token);
      const record = await store.findSession(tokenHash);
      if (!record) return null;
      if (record.session.expiresAt <= now()) {
        await store.deleteSession(tokenHash);
        return null;
      }
      return record.user;
    },

    async signOut(token: string | null) {
      if (token) await store.deleteSession(await sha256(token));
    },

    async seedDemoUsers(driverPassword: string, passengerPassword: string) {
      const timestamp = now();
      const accounts = [
        { email: 'driver@demo.pudle.local', displayName: 'Demo Driver', password: driverPassword },
        { email: 'passenger@demo.pudle.local', displayName: 'Demo Passenger', password: passengerPassword },
      ];
      for (const account of accounts) {
        const existing = await store.findUserByEmail(account.email);
        const user: UserRecord = {
          id: existing?.id ?? createId(),
          email: account.email,
          displayName: account.displayName,
          passwordHash: await hashPassword(validatePassword(account.password)),
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (existing) await store.deleteUserSessions(existing.id);
        await store.upsertDemoUser(user);
      }
      return accounts.map(({ email, displayName }) => ({ email, displayName }));
    },
  };
}
