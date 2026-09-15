import { notifySessionExpired } from './session-events';

export const RIDE_CSRF_HEADER = 'X-Pudle-CSRF';

export interface RideGroup {
  id: string;
  name: string;
  role: string;
  joinedAt: number;
}

export interface RideMessage {
  id: string;
  body: string;
  displayName: string;
  createdAt: number;
}

export interface RideMessagePage {
  messages: RideMessage[];
  nextCursor: string | null;
}

export interface RideApi {
  listGroups(signal?: AbortSignal): Promise<RideGroup[]>;
  createGroup(name: string, signal?: AbortSignal): Promise<RideGroup>;
  createInvite(groupId: string, email: string, signal?: AbortSignal): Promise<{ token: string; expiresAt: number }>;
  redeemInvite(token: string, signal?: AbortSignal): Promise<{ groupId: string }>;
  leaveGroup(groupId: string, signal?: AbortSignal): Promise<void>;
  listMessages(groupId: string, cursor: string | null, signal?: AbortSignal): Promise<RideMessagePage>;
  sendMessage(
    groupId: string,
    body: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Pick<RideMessage, 'id' | 'body' | 'createdAt'>>;
}

export class RideApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'RideApiError';
  }
}

const MAX_RESPONSE_BYTES = 128 * 1024;
const identifierPattern = /^[A-Za-z0-9_-]{1,80}$/;
const cursorPattern = /^\d{1,16}$/;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RideApiError(`The server returned an invalid ${label}.`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.length === 0)) {
    throw new RideApiError(`The server returned an invalid ${label}.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RideApiError(`The server returned an invalid ${label}.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = string(value, label, 80);
  if (!identifierPattern.test(result)) throw new RideApiError(`The server returned an invalid ${label}.`);
  return result;
}

function validateGroup(value: unknown): RideGroup {
  const group = object(value, 'group');
  return {
    id: identifier(group.id, 'group ID'),
    name: string(group.name, 'group name', 80),
    role: string(group.role, 'group role', 32),
    joinedAt: timestamp(group.joinedAt, 'join time'),
  };
}

function validateMessage(value: unknown): RideMessage {
  const message = object(value, 'message');
  return {
    id: identifier(message.id, 'message ID'),
    body: string(message.body, 'message body', 1_000),
    displayName: string(message.displayName, 'display name', 60),
    createdAt: timestamp(message.createdAt, 'message time'),
  };
}

function validateLocalIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new RideApiError(`Invalid ${label}.`);
  return value;
}

async function readResponse(response: Response): Promise<unknown> {
  notifySessionExpired(response.status);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new RideApiError('The server response was too large.', response.status);
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RideApiError('The server response was too large.', response.status);
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RideApiError('The server returned invalid UTF-8.', response.status);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new RideApiError('The server returned invalid JSON.', response.status);
  }
  if (!response.ok) {
    const error = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as JsonObject).error
      : undefined;
    throw new RideApiError(
      typeof error === 'string' && error.length <= 500 ? error : `Ride request failed (${response.status}).`,
      response.status,
    );
  }
  return body;
}

function jsonRequest(method: string, body?: JsonObject, signal?: AbortSignal, headers?: HeadersInit): RequestInit {
  return {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { [RIDE_CSRF_HEADER]: '1' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

export function createRideApi(fetcher: typeof fetch = globalThis.fetch): RideApi {
  const request = async (url: string, init: RequestInit) => readResponse(await fetcher(url, init));

  return {
    async listGroups(signal) {
      const payload = object(await request('/api/groups', jsonRequest('GET', undefined, signal)), 'group list');
      if (!Array.isArray(payload.groups) || payload.groups.length > 100) {
        throw new RideApiError('The server returned an invalid group list.');
      }
      return payload.groups.map(validateGroup);
    },

    async createGroup(name, signal) {
      const payload = object(
        await request('/api/groups', jsonRequest('POST', { name }, signal)),
        'group',
      );
      return validateGroup(payload.group);
    },

    async createInvite(groupId, email, signal) {
      validateLocalIdentifier(groupId, 'group ID');
      const payload = object(
        await request(
          `/api/groups/${encodeURIComponent(groupId)}/invites`,
          jsonRequest('POST', { email }, signal),
        ),
        'invite',
      );
      const invite = object(payload.invite, 'invite');
      return {
        token: string(invite.token, 'invite token', 128),
        expiresAt: timestamp(invite.expiresAt, 'invite expiry'),
      };
    },

    async redeemInvite(token, signal) {
      const payload = object(
        await request('/api/groups/invites/redeem', jsonRequest('POST', { token }, signal)),
        'membership',
      );
      const membership = object(payload.membership, 'membership');
      return { groupId: identifier(membership.groupId, 'group ID') };
    },

    async leaveGroup(groupId, signal) {
      validateLocalIdentifier(groupId, 'group ID');
      await request(
        `/api/groups/${encodeURIComponent(groupId)}/membership`,
        jsonRequest('DELETE', undefined, signal),
      );
    },

    async listMessages(groupId, cursor, signal) {
      validateLocalIdentifier(groupId, 'group ID');
      if (cursor !== null && !cursorPattern.test(cursor)) throw new RideApiError('Invalid message cursor.');
      const query = new URLSearchParams({ limit: '50' });
      if (cursor !== null) query.set('cursor', cursor);
      const payload = object(
        await request(
          `/api/groups/${encodeURIComponent(groupId)}/messages?${query}`,
          jsonRequest('GET', undefined, signal),
        ),
        'message list',
      );
      if (!Array.isArray(payload.messages) || payload.messages.length > 50) {
        throw new RideApiError('The server returned an invalid message list.');
      }
      const nextCursor = payload.nextCursor;
      if (nextCursor !== null && (typeof nextCursor !== 'string' || !cursorPattern.test(nextCursor))) {
        throw new RideApiError('The server returned an invalid message cursor.');
      }
      return { messages: payload.messages.map(validateMessage), nextCursor };
    },

    async sendMessage(groupId, body, idempotencyKey, signal) {
      validateLocalIdentifier(groupId, 'group ID');
      if (!/^[A-Za-z0-9._~-]{8,128}$/.test(idempotencyKey)) {
        throw new RideApiError('Invalid idempotency key.');
      }
      const payload = object(
        await request(
          `/api/groups/${encodeURIComponent(groupId)}/messages`,
          jsonRequest('POST', { body }, signal, { 'Idempotency-Key': idempotencyKey }),
        ),
        'message',
      );
      const message = object(payload.message, 'message');
      return {
        id: identifier(message.id, 'message ID'),
        body: string(message.body, 'message body', 1_000),
        createdAt: timestamp(message.createdAt, 'message time'),
      };
    },
  };
}

export const rideApi = createRideApi();
