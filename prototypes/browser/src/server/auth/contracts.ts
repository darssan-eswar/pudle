export const SESSION_COOKIE = '__Host-pudle_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
};

export type UserRecord = PublicUser & {
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type AuthStore = {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUserWithSession(user: UserRecord, session: SessionRecord): Promise<void>;
  upsertDemoUser(user: UserRecord): Promise<void>;
  findSession(tokenHash: string): Promise<{ session: SessionRecord; user: PublicUser } | null>;
  replaceUserSession(session: SessionRecord): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  consumeRateLimit(keyHash: string, limit: number, windowMs: number, now: number): Promise<boolean>;
  cleanupExpired(now: number): Promise<void>;
  isGroupMember(userId: string, groupId: string, now: number): Promise<boolean>;
};

export class IdentityConflictError extends Error {}
