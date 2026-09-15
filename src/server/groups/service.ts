import { HttpError } from '@/server/http';
import { createRuntimeId } from '@/server/runtime-id.mjs';
import { createOpaqueToken, sha256 } from '@/server/security';

const GROUP_TTL_MS = 24 * 60 * 60_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const MAX_MESSAGE_LENGTH = 1_000;

export type GroupSummary = {
  id: string;
  name: string;
  role: string;
  joinedAt: number;
};

export type MessageRecord = {
  id: string;
  groupId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: number;
  sequence: number;
};

export type GroupsStore = {
  createGroup(group: { id: string; ownerUserId: string; name: string; createdAt: number; expiresAt: number }): Promise<void>;
  listGroups(userId: string, now: number): Promise<GroupSummary[]>;
  groupRole(userId: string, groupId: string, now: number): Promise<string | null>;
  createInvite(invite: { id: string; groupId: string; userId: string; email: string; tokenHash: string; createdAt: number; expiresAt: number }): Promise<boolean>;
  redeemInvite(tokenHash: string, userId: string, email: string, now: number): Promise<{ groupId: string; alreadyMember: boolean } | null>;
  leaveGroup(groupId: string, userId: string, now: number): Promise<'left' | 'owner' | 'missing'>;
  findIdempotent(userId: string, scope: string, keyHash: string, now: number): Promise<{ status: number; body: string } | null>;
  saveMessage(message: Omit<MessageRecord, 'displayName' | 'sequence'>, keyHash: string, responseBody: string, now: number, idempotencyExpiresAt: number): Promise<boolean>;
  listMessages(userId: string, groupId: string, cursor: number | null, limit: number, now: number): Promise<MessageRecord[]>;
};

function normalizedName(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'A group name is required.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 80) throw new HttpError(400, 'Group name must be 1 to 80 characters.');
  return name;
}

function normalizedEmail(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'A valid invite email is required.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'A valid invite email is required.');
  }
  return email;
}

export function validateMessageBody(value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message must be 1 to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return value;
}

function safeDisplayName(value: string) {
  const displayName = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return displayName || 'Member';
}

export function encodeCursor(message: Pick<MessageRecord, 'sequence'>) {
  return String(message.sequence);
}

export function parseCursor(value: string | null) {
  if (value === null || value === '') return null;
  if (!/^\d{1,16}$/.test(value)) throw new HttpError(400, 'Invalid message cursor.');
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new HttpError(400, 'Invalid message cursor.');
  return sequence;
}

export function createGroupsService(store: GroupsStore, options?: { now?: () => number; createId?: () => string; createToken?: () => string }) {
  const now = options?.now ?? Date.now;
  const createId = options?.createId ?? createRuntimeId;
  const createToken = options?.createToken ?? createOpaqueToken;

  async function requireMember(userId: string, groupId: string) {
    const role = await store.groupRole(userId, groupId, now());
    if (!role) throw new HttpError(403, 'Group membership required.');
    return role;
  }

  return {
    async createGroup(userId: string, body: Record<string, unknown>) {
      const timestamp = now();
      const group = {
        id: createId(),
        ownerUserId: userId,
        name: normalizedName(body.name),
        createdAt: timestamp,
        expiresAt: timestamp + GROUP_TTL_MS,
      };
      await store.createGroup(group);
      return { group: { id: group.id, name: group.name, role: 'owner', joinedAt: timestamp } };
    },

    async listGroups(userId: string) {
      return store.listGroups(userId, now());
    },

    async createInvite(userId: string, groupId: string, body: Record<string, unknown>) {
      if (await requireMember(userId, groupId) !== 'owner') {
        throw new HttpError(403, 'Only the group owner may create invites.');
      }
      const email = normalizedEmail(body.email);
      const expiresInMinutes = body.expiresInMinutes === undefined ? 60 : body.expiresInMinutes;
      if (!Number.isInteger(expiresInMinutes) || (expiresInMinutes as number) < 5 || (expiresInMinutes as number) > 1_440) {
        throw new HttpError(400, 'Invite expiry must be between 5 and 1440 minutes.');
      }
      const token = createToken();
      const timestamp = now();
      const created = await store.createInvite({
        id: createId(),
        groupId,
        userId,
        email,
        tokenHash: await sha256(token),
        createdAt: timestamp,
        expiresAt: timestamp + (expiresInMinutes as number) * 60_000,
      });
      if (!created) throw new HttpError(403, 'Active group ownership required.');
      return { invite: { token, expiresAt: timestamp + (expiresInMinutes as number) * 60_000 } };
    },

    async redeemInvite(userId: string, userEmail: string, body: Record<string, unknown>) {
      if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 128) {
        throw new HttpError(400, 'Invalid invite token.');
      }
      const result = await store.redeemInvite(await sha256(body.token), userId, userEmail.toLowerCase(), now());
      if (!result) throw new HttpError(410, 'Invite is invalid, expired, or already used.');
      return { membership: { groupId: result.groupId } };
    },

    async leave(userId: string, groupId: string) {
      const result = await store.leaveGroup(groupId, userId, now());
      if (result === 'missing') throw new HttpError(404, 'Membership not found.');
      if (result === 'owner') throw new HttpError(409, 'The group owner cannot leave the group.');
      return { left: true };
    },

    async sendMessage(userId: string, groupId: string, body: Record<string, unknown>, idempotencyKey: string) {
      await requireMember(userId, groupId);
      const timestamp = now();
      const scope = `message:${groupId}`;
      const keyHash = await sha256(idempotencyKey);
      const prior = await store.findIdempotent(userId, scope, keyHash, timestamp);
      if (prior) return { status: prior.status, body: JSON.parse(prior.body) as unknown };
      const message = {
        id: createId(),
        groupId,
        userId,
        body: validateMessageBody(body.body),
        createdAt: timestamp,
      };
      const response = { message: { id: message.id, body: message.body, createdAt: message.createdAt } };
      try {
        const saved = await store.saveMessage(
          message,
          keyHash,
          JSON.stringify(response),
          timestamp,
          timestamp + IDEMPOTENCY_TTL_MS,
        );
        if (!saved) throw new HttpError(403, 'Group membership required.');
      } catch (error) {
        const winner = await store.findIdempotent(userId, scope, keyHash, timestamp);
        if (!winner) throw error;
        return { status: winner.status, body: JSON.parse(winner.body) as unknown };
      }
      return { status: 201, body: response };
    },

    async listMessages(userId: string, groupId: string, cursorValue: string | null, limitValue: string | null) {
      await requireMember(userId, groupId);
      const cursor = parseCursor(cursorValue);
      const parsedLimit = limitValue === null ? 50 : Number(limitValue);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        throw new HttpError(400, 'Message limit must be between 1 and 50.');
      }
      const messages = await store.listMessages(userId, groupId, cursor, parsedLimit, now());
      const last = messages.at(-1);
      return {
        messages: messages.map(({ id, body, displayName, createdAt }) => ({
          id,
          body: body.slice(0, MAX_MESSAGE_LENGTH),
          displayName: safeDisplayName(displayName),
          createdAt,
        })),
        nextCursor: last ? encodeCursor(last) : cursorValue,
      };
    },
  };
}
