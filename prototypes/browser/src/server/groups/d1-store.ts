import type { GroupsStore, MessageRecord } from './service';

export class D1GroupsStore implements GroupsStore {
  constructor(private readonly d1: D1Database) {}

  async createGroup(group: { id: string; ownerUserId: string; name: string; createdAt: number; expiresAt: number }) {
    await this.d1.batch([
      this.d1.prepare(
        'INSERT INTO groups (id, owner_user_id, name, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(group.id, group.ownerUserId, group.name, group.expiresAt, group.createdAt, group.createdAt),
      this.d1.prepare(
        "INSERT INTO group_memberships (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      ).bind(group.id, group.ownerUserId, group.createdAt),
    ]);
  }

  async listGroups(userId: string, now: number) {
    const result = await this.d1.prepare(
      `SELECT g.id, substr(g.name, 1, 80) AS name, gm.role, gm.joined_at AS joinedAt
       FROM group_memberships gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ? AND (g.expires_at IS NULL OR g.expires_at > ?)
       ORDER BY gm.joined_at DESC LIMIT 50`,
    ).bind(userId, now).all<{ id: string; name: string; role: string; joinedAt: number }>();
    return result.results;
  }

  async groupRole(userId: string, groupId: string, now: number) {
    const row = await this.d1.prepare(
      `SELECT gm.role FROM group_memberships gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ? AND gm.group_id = ? AND (g.expires_at IS NULL OR g.expires_at > ?)`,
    ).bind(userId, groupId, now).first<{ role: string }>();
    return row?.role ?? null;
  }

  async createInvite(invite: { id: string; groupId: string; userId: string; email: string; tokenHash: string; createdAt: number; expiresAt: number }) {
    const result = await this.d1.prepare(
      `INSERT INTO group_invites
       (id, group_id, invited_by_user_id, email, token_hash, created_at, expires_at)
       SELECT ?, g.id, ?, ?, ?, ?, ?
       FROM groups g JOIN group_memberships gm ON gm.group_id = g.id
       WHERE g.id = ? AND gm.user_id = ? AND gm.role = 'owner'
         AND (g.expires_at IS NULL OR g.expires_at > ?)`,
    ).bind(
      invite.id,
      invite.userId,
      invite.email,
      invite.tokenHash,
      invite.createdAt,
      invite.expiresAt,
      invite.groupId,
      invite.userId,
      invite.createdAt,
    ).run();
    return result.meta.changes === 1;
  }

  async redeemInvite(tokenHash: string, userId: string, email: string, now: number) {
    const invite = await this.d1.prepare(
      `SELECT gi.group_id
       FROM group_invites gi JOIN groups g ON g.id = gi.group_id
       WHERE gi.token_hash = ? AND gi.email = ? AND gi.accepted_at IS NULL
         AND gi.expires_at > ? AND (g.expires_at IS NULL OR g.expires_at > ?)`,
    ).bind(tokenHash, email, now, now).first<{ group_id: string }>();
    if (!invite) return null;
    const results = await this.d1.batch([
      this.d1.prepare(
        `INSERT INTO group_memberships (group_id, user_id, role, joined_at)
         SELECT gi.group_id, ?, 'member', ?
         FROM group_invites gi JOIN groups g ON g.id = gi.group_id
         WHERE gi.token_hash = ? AND gi.email = ? AND gi.accepted_at IS NULL
           AND gi.expires_at > ? AND (g.expires_at IS NULL OR g.expires_at > ?)
         ON CONFLICT(group_id, user_id) DO NOTHING`,
      ).bind(userId, now, tokenHash, email, now, now),
      this.d1.prepare(
        `UPDATE group_invites SET accepted_at = ?
         WHERE token_hash = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM groups g
             JOIN group_memberships gm ON gm.group_id = g.id
             WHERE g.id = group_invites.group_id AND gm.user_id = ?
               AND (g.expires_at IS NULL OR g.expires_at > ?)
           )`,
      ).bind(now, tokenHash, email, now, userId, now),
    ]);
    if (results[1].meta.changes !== 1) return null;
    return { groupId: invite.group_id, alreadyMember: results[0].meta.changes === 0 };
  }

  async leaveGroup(groupId: string, userId: string, now: number) {
    const role = await this.groupRole(userId, groupId, now);
    if (!role) return 'missing' as const;
    if (role === 'owner') return 'owner' as const;
    await this.d1.prepare('DELETE FROM group_memberships WHERE group_id = ? AND user_id = ?')
      .bind(groupId, userId).run();
    return 'left' as const;
  }

  async findIdempotent(userId: string, scope: string, keyHash: string, now: number) {
    const row = await this.d1.prepare(
      `SELECT response_status AS status, response_body AS body FROM idempotency_records
       WHERE user_id = ? AND scope = ? AND key_hash = ? AND expires_at > ?`,
    ).bind(userId, scope, keyHash, now).first<{ status: number; body: string }>();
    return row ?? null;
  }

  async saveMessage(message: Omit<MessageRecord, 'displayName' | 'sequence'>, keyHash: string, responseBody: string, now: number, idempotencyExpiresAt: number) {
    const results = await this.d1.batch([
      this.d1.prepare(
        `INSERT INTO messages (id, group_id, user_id, body, created_at, expires_at)
         SELECT ?, g.id, ?, ?, ?, ?
         FROM groups g JOIN group_memberships gm ON gm.group_id = g.id
         WHERE g.id = ? AND gm.user_id = ?
           AND (g.expires_at IS NULL OR g.expires_at > ?)`,
      ).bind(
        message.id,
        message.userId,
        message.body,
        message.createdAt,
        message.createdAt + MESSAGE_TTL_MS,
        message.groupId,
        message.userId,
        now,
      ),
      this.d1.prepare(
        `INSERT INTO idempotency_records
         (scope, key_hash, user_id, resource_id, response_status, response_body, created_at, expires_at)
         SELECT ?, ?, ?, m.id, 201, ?, ?, ?
         FROM messages m WHERE m.id = ?`,
      ).bind(
        `message:${message.groupId}`,
        keyHash,
        message.userId,
        responseBody,
        now,
        idempotencyExpiresAt,
        message.id,
      ),
    ]);
    return results[0].meta.changes === 1;
  }

  async listMessages(userId: string, groupId: string, cursor: number | null, limit: number, now: number) {
    const result = await this.d1.prepare(
      `SELECT m.id, m.group_id AS groupId, m.user_id AS userId, u.display_name AS displayName,
              m.body, m.created_at AS createdAt, m.sequence
       FROM messages m
       JOIN users u ON u.id = m.user_id
       JOIN groups g ON g.id = m.group_id
       JOIN group_memberships gm ON gm.group_id = g.id
       WHERE m.group_id = ? AND gm.user_id = ? AND m.expires_at > ?
         AND (g.expires_at IS NULL OR g.expires_at > ?) AND m.sequence > ?
       ORDER BY m.sequence ASC LIMIT ?`,
    ).bind(groupId, userId, now, now, cursor ?? 0, limit).all<MessageRecord>();
    return result.results;
  }
}

const MESSAGE_TTL_MS = 24 * 60 * 60_000;
