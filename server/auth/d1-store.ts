import {
  IdentityConflictError,
  type AuthStore,
  type PublicUser,
  type SessionRecord,
  type UserRecord,
} from './contracts';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
};

type SessionUserRow = PublicUser & {
  session_id: string;
  user_id: string;
  token_hash: string;
  session_created_at: number;
  last_seen_at: number;
  expires_at: number;
};

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1AuthStore implements AuthStore {
  constructor(private readonly d1: D1Database) {}

  async findUserByEmail(email: string) {
    const row = await this.d1.prepare(
      'SELECT id, email, display_name, password_hash, created_at, updated_at FROM users WHERE email = ?',
    ).bind(email).first<UserRow>();
    return row ? toUser(row) : null;
  }

  async createUser(user: UserRecord) {
    try {
      await this.d1.prepare(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(user.id, user.email, user.displayName, user.passwordHash, user.createdAt, user.updatedAt).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.email')) {
        throw new IdentityConflictError();
      }
      throw error;
    }
  }

  async upsertDemoUser(user: UserRecord) {
    await this.d1.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         password_hash = excluded.password_hash,
         updated_at = excluded.updated_at`,
    ).bind(user.id, user.email, user.displayName, user.passwordHash, user.createdAt, user.updatedAt).run();
  }

  async findSession(tokenHash: string) {
    const row = await this.d1.prepare(
      `SELECT s.id AS session_id, s.user_id, s.token_hash, s.created_at AS session_created_at,
              s.last_seen_at, s.expires_at, u.id, u.email, u.display_name AS displayName
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    ).bind(tokenHash).first<SessionUserRow>();
    if (!row) return null;
    return {
      session: {
        id: row.session_id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        createdAt: row.session_created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
      },
      user: { id: row.id, email: row.email, displayName: row.displayName },
    };
  }

  async createSession(session: SessionRecord) {
    await this.d1.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      session.userId,
      session.tokenHash,
      session.createdAt,
      session.lastSeenAt,
      session.expiresAt,
    ).run();
  }

  async deleteSession(tokenHash: string) {
    await this.d1.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async deleteUserSessions(userId: string) {
    await this.d1.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  }

  async consumeRateLimit(keyHash: string, limit: number, windowMs: number, now: number) {
    const windowStartedAt = Math.floor(now / windowMs) * windowMs;
    const expiresAt = windowStartedAt + windowMs;
    const result = await this.d1.prepare(
      `INSERT INTO rate_limits (key_hash, window_started_at, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key_hash, window_started_at) DO UPDATE SET count = count + 1
       RETURNING count`,
    ).bind(keyHash, windowStartedAt, expiresAt).first<{ count: number }>();
    return Boolean(result && result.count <= limit);
  }

  async cleanupExpired(now: number) {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM idempotency_records WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM analysis_results WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM analysis_jobs WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM recordings WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM messages WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM group_invites WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM groups WHERE expires_at IS NOT NULL AND expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM event_acknowledgements WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM road_events WHERE expires_at <= ?').bind(now),
    ]);
  }

  async isGroupMember(userId: string, groupId: string) {
    const row = await this.d1.prepare(
      'SELECT 1 AS allowed FROM group_memberships WHERE user_id = ? AND group_id = ?',
    ).bind(userId, groupId).first<{ allowed: number }>();
    return row?.allowed === 1;
  }
}
