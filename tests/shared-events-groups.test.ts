import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import type { EventRecord, EventStore } from '../server/events/service';
import { createEventService, EVENT_TTL_MS, parseCreateEvent } from '../server/events/service';
import type { GroupsStore, GroupSummary, MessageRecord } from '../server/groups/service';
import { createGroupsService, validateMessageBody } from '../server/groups/service';
import { D1GroupsStore } from '../server/groups/d1-store';
import { HttpError } from '../server/http';

async function expectStatus(action: () => Promise<unknown> | unknown, status: number) {
  await assert.rejects(
    async () => action(),
    (error: unknown) => error instanceof HttpError && error.status === status,
  );
}

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    readonly query: string,
    readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]) {
    return new SqliteD1Statement(this.database, this.query, values);
  }

  execute() {
    const result = this.database.prepare(this.query).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }

  async run() {
    return this.execute();
  }

  async first<T>() {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      meta: { changes: 0 },
      results: this.database.prepare(this.query).all(...this.values) as T[],
    };
  }
}

class SqliteD1Database {
  failBatchAt: number | null = null;

  constructor(readonly database = new DatabaseSync(':memory:')) {}

  prepare(query: string) {
    return new SqliteD1Statement(this.database, query);
  }

  async batch(statements: SqliteD1Statement[]) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (this.failBatchAt === index) {
          this.failBatchAt = null;
          throw new Error('simulated D1 batch failure');
        }
        return statement.execute();
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function migratedD1Fixture() {
  const sqlite = new SqliteD1Database();
  for (const migration of [
    'drizzle/0000_woozy_paladin.sql',
    'drizzle/0001_sad_ares.sql',
    'drizzle/0002_fix-road-event-user-fk.sql',
    'drizzle/0003_curvy_texas_twister.sql',
  ]) {
    sqlite.database.exec(readFileSync(migration, 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  const insertUser = sqlite.database.prepare(
    'INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)',
  );
  insertUser.run('owner', 'owner@example.com', 'Owner', 'hash');
  insertUser.run('rider-a', 'a@example.com', 'Rider A', 'hash');
  insertUser.run('rider-b', 'b@example.com', 'Rider B', 'hash');
  return {
    sqlite,
    store: new D1GroupsStore(sqlite as unknown as D1Database),
  };
}

class MemoryEventStore implements EventStore {
  events: EventRecord[] = [];
  acknowledgements = new Set<string>();
  idempotency = new Map<string, { status: number; body: string; expiresAt: number }>();

  async findIdempotent(userId: string, scope: string, keyHash: string, now: number) {
    const value = this.idempotency.get(`${userId}:${scope}:${keyHash}`);
    return value && value.expiresAt > now ? value : null;
  }

  async saveEvent(event: EventRecord, keyHash: string, responseBody: string, _now: number, expiresAt: number) {
    this.events.push(event);
    this.idempotency.set(`${event.userId}:event:create:${keyHash}`, { status: 201, body: responseBody, expiresAt });
  }

  async nearby() {
    return this.events;
  }

  async acknowledge(eventId: string, userId: string, now: number) {
    const event = this.events.find((value) => value.id === eventId && value.expiresAt > now && value.resolvedAt === null);
    if (!event) return 'missing' as const;
    const key = `${eventId}:${userId}`;
    const existing = this.acknowledgements.has(key);
    this.acknowledgements.add(key);
    return existing ? 'existing' as const : 'created' as const;
  }

  async resolve(eventId: string, userId: string, now: number) {
    const event = this.events.find((value) => value.id === eventId && value.expiresAt > now);
    if (!event) return 'missing' as const;
    if (event.userId !== userId) return 'forbidden' as const;
    if (event.resolvedAt !== null) return 'existing' as const;
    event.resolvedAt = now;
    return 'resolved' as const;
  }
}

test('event reports round coordinates and retry without duplicating', async () => {
  const store = new MemoryEventStore();
  const service = createEventService(store, { now: () => 1_000_000, createId: () => 'event-1' });
  const input = {
    type: 'road-hazard',
    latitude: 40.12349,
    longitude: -73.98751,
    confidence: 0.7,
    direction: 'NE',
    source: 'edge-ai',
  };
  const first = await service.create('user-a', input, 'retry-key-1');
  const retry = await service.create('user-a', input, 'retry-key-1');

  assert.deepEqual(retry, first);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].latitude, 40.123);
  assert.equal(store.events[0].longitude, -73.988);
  assert.equal(store.events[0].source, 'edge-ai');
  assert.equal(JSON.stringify(first).includes('latitude'), false);
  assert.equal(JSON.stringify(first).includes('longitude'), false);
});

test('nearby events enforce radius, age, expiry, and coordinate non-disclosure', async () => {
  const now = 2_000_000;
  const store = new MemoryEventStore();
  const base: EventRecord = {
    id: 'near',
    userId: 'owner',
    type: 'crash',
    latitude: 40,
    longitude: -74,
    confidence: 1,
    source: 'manual',
    direction: null,
    createdAt: now - 1_000,
    expiresAt: now + 1_000,
    resolvedAt: null,
  };
  store.events.push(
    base,
    { ...base, id: 'far', latitude: 40.1 },
    { ...base, id: 'old', createdAt: now - EVENT_TTL_MS - 1 },
    { ...base, id: 'expired', expiresAt: now },
  );
  const result = await createEventService(store, { now: () => now }).nearby(40, -74);
  assert.deepEqual(result.map((event) => event.id), ['near']);
  assert.equal(Object.hasOwn(result[0], 'latitude'), false);
  assert.equal(Object.hasOwn(result[0], 'longitude'), false);
  assert.equal(Object.hasOwn(result[0], 'distanceMiles'), false);
  assert.equal(result[0].distanceBand, 'within-half-mile');
});

test('event metadata rejects invalid ranges, confidence, and adversarial values', () => {
  assert.throws(() => parseCreateEvent({ type: '<script>', latitude: 0, longitude: 0 }), HttpError);
  assert.throws(() => parseCreateEvent({ type: 'crash', latitude: 91, longitude: 0 }), HttpError);
  assert.throws(() => parseCreateEvent({ type: 'crash', latitude: 0, longitude: 0, confidence: 2 }), HttpError);
  assert.throws(() => parseCreateEvent({ type: 'crash', latitude: 0, longitude: 0, direction: '../../private' }), HttpError);
});

test('only event owner resolves while acknowledgements are one per user', async () => {
  const store = new MemoryEventStore();
  const service = createEventService(store, { now: () => 10_000, createId: () => 'event-1' });
  await service.create('owner', { type: 'crash', latitude: 0, longitude: 0 }, 'event-key');
  await expectStatus(() => service.resolve('event-1', 'other'), 403);
  assert.deepEqual(await service.acknowledge('event-1', 'other'), { acknowledged: true });
  assert.deepEqual(await service.acknowledge('event-1', 'other'), { acknowledged: true });
  assert.equal(store.acknowledgements.size, 1);
  assert.deepEqual(await service.resolve('event-1', 'owner'), { resolved: true });
});

type Invite = { tokenHash: string; groupId: string; email: string; expiresAt: number; accepted: boolean };

class MemoryGroupsStore implements GroupsStore {
  groups = new Map<string, { name: string; expiresAt: number }>();
  memberships = new Map<string, string>();
  invites: Invite[] = [];
  messages: MessageRecord[] = [];
  idempotency = new Map<string, { status: number; body: string; expiresAt: number }>();
  nextSequence = 0;
  failNextRedemption = false;

  async createGroup(group: { id: string; ownerUserId: string; name: string; createdAt: number; expiresAt: number }) {
    this.groups.set(group.id, { name: group.name, expiresAt: group.expiresAt });
    this.memberships.set(`${group.id}:${group.ownerUserId}`, 'owner');
  }

  async listGroups(userId: string, now: number): Promise<GroupSummary[]> {
    return [...this.groups].flatMap(([id, group]) => {
      const role = this.memberships.get(`${id}:${userId}`);
      return role && group.expiresAt > now ? [{ id, name: group.name, role, joinedAt: 1 }] : [];
    });
  }

  async groupRole(userId: string, groupId: string, now: number) {
    if ((this.groups.get(groupId)?.expiresAt ?? 0) <= now) return null;
    return this.memberships.get(`${groupId}:${userId}`) ?? null;
  }

  async createInvite(invite: { groupId: string; email: string; tokenHash: string; expiresAt: number }) {
    this.invites.push({ ...invite, accepted: false });
    return true;
  }

  async redeemInvite(tokenHash: string, userId: string, email: string, now: number) {
    const invite = this.invites.find((value) => value.tokenHash === tokenHash
      && value.email === email
      && !value.accepted
      && value.expiresAt > now
      && (this.groups.get(value.groupId)?.expiresAt ?? 0) > now);
    if (!invite) return null;
    if (this.failNextRedemption) {
      this.failNextRedemption = false;
      throw new Error('simulated transactional membership failure');
    }
    invite.accepted = true;
    this.memberships.set(`${invite.groupId}:${userId}`, 'member');
    return { groupId: invite.groupId, alreadyMember: false };
  }

  async leaveGroup(groupId: string, userId: string, now: number) {
    const role = await this.groupRole(userId, groupId, now);
    if (!role) return 'missing' as const;
    if (role === 'owner') return 'owner' as const;
    this.memberships.delete(`${groupId}:${userId}`);
    return 'left' as const;
  }

  async findIdempotent(userId: string, scope: string, keyHash: string, now: number) {
    const value = this.idempotency.get(`${userId}:${scope}:${keyHash}`);
    return value && value.expiresAt > now ? value : null;
  }

  async saveMessage(message: Omit<MessageRecord, 'displayName' | 'sequence'>, keyHash: string, body: string, _now: number, expiresAt: number) {
    this.nextSequence += 1;
    this.messages.push({ ...message, sequence: this.nextSequence, displayName: message.userId === 'owner' ? 'Owner' : 'Passenger' });
    this.idempotency.set(`${message.userId}:message:${message.groupId}:${keyHash}`, { status: 201, body, expiresAt });
    return true;
  }

  async listMessages(_userId: string, groupId: string, cursor: number | null, limit: number) {
    return this.messages
      .filter((message) => message.groupId === groupId && message.sequence > (cursor ?? 0))
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }
}

function groupsFixture() {
  let now = 5_000_000;
  let id = 0;
  const store = new MemoryGroupsStore();
  const service = createGroupsService(store, {
    now: () => now,
    createId: () => `id-${++id}`,
    createToken: () => 'invite-token-that-is-long-enough',
  });
  return { store, service, advance: (milliseconds: number) => { now += milliseconds; } };
}

test('invite redemption is email-bound, expiry-bound, and single-use', async () => {
  const { service, advance } = groupsFixture();
  const created = await service.createGroup('owner', { name: ' Demo Ride ' });
  const groupId = created.group.id;
  const invite = await service.createInvite('owner', groupId, { email: 'Rider@Example.com', expiresInMinutes: 5 });
  await expectStatus(() => service.redeemInvite('wrong', 'other@example.com', { token: invite.invite.token }), 410);
  assert.deepEqual(await service.redeemInvite('rider', 'rider@example.com', { token: invite.invite.token }), { membership: { groupId } });
  await expectStatus(() => service.redeemInvite('rider-2', 'rider@example.com', { token: invite.invite.token }), 410);

  const second = await service.createInvite('owner', groupId, { email: 'late@example.com', expiresInMinutes: 5 });
  advance(5 * 60_000 + 1);
  await expectStatus(() => service.redeemInvite('late', 'late@example.com', { token: second.invite.token }), 410);
});

test('concurrent invite redemption has one winner', async () => {
  const { service } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  const { invite } = await service.createInvite('owner', groupId, { email: 'rider@example.com' });
  const results = await Promise.allSettled([
    service.redeemInvite('rider', 'rider@example.com', { token: invite.token }),
    service.redeemInvite('rider', 'rider@example.com', { token: invite.token }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected'
    && result.reason instanceof HttpError
    && result.reason.status === 410).length, 1);
});

test('failed membership creation does not consume invite', async () => {
  const { service, store } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  const { invite } = await service.createInvite('owner', groupId, { email: 'rider@example.com' });
  store.failNextRedemption = true;
  await assert.rejects(
    () => service.redeemInvite('rider', 'rider@example.com', { token: invite.token }),
    /simulated transactional membership failure/,
  );
  assert.equal(store.invites[0].accepted, false);
  assert.deepEqual(
    await service.redeemInvite('rider', 'rider@example.com', { token: invite.token }),
    { membership: { groupId } },
  );
});

test('invite redemption rejects an expired parent group', async () => {
  const { service, advance } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  advance(23 * 60 * 60_000);
  const { invite } = await service.createInvite('owner', groupId, {
    email: 'rider@example.com',
    expiresInMinutes: 120,
  });
  advance(61 * 60_000);
  await expectStatus(
    () => service.redeemInvite('rider', 'rider@example.com', { token: invite.token }),
    410,
  );
});

test('group and message operations isolate non-members', async () => {
  const { service } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  await expectStatus(() => service.createInvite('outsider', groupId, { email: 'x@example.com' }), 403);
  await expectStatus(() => service.sendMessage('outsider', groupId, { body: 'hello' }, 'message-key'), 403);
  await expectStatus(() => service.listMessages('outsider', groupId, null, null), 403);
  await expectStatus(() => service.leave('owner', groupId), 409);
  assert.deepEqual(await service.listGroups('outsider'), []);
});

test('messages remain plain text and retry/cursor polling deduplicates', async () => {
  const { service, store } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  const malicious = '<img src=x onerror=alert(1)>';
  const first = await service.sendMessage('owner', groupId, { body: malicious }, 'message-key-1');
  const retry = await service.sendMessage('owner', groupId, { body: 'changed' }, 'message-key-1');
  assert.deepEqual(retry, first);
  assert.equal(store.messages.length, 1);

  const page = await service.listMessages('owner', groupId, null, '1');
  assert.equal(page.messages[0].body, malicious);
  assert.equal(page.messages[0].displayName, 'Owner');
  assert.equal(JSON.stringify(page).includes('userId'), false);
  await service.sendMessage('owner', groupId, { body: 'same millisecond' }, 'message-key-2');
  const next = await service.listMessages('owner', groupId, page.nextCursor, '50');
  assert.deepEqual(next.messages.map((message) => message.body), ['same millisecond']);
  const empty = await service.listMessages('owner', groupId, next.nextCursor, '50');
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.nextCursor, next.nextCursor);

  store.messages.length = 0;
  const afterRetention = await service.sendMessage('owner', groupId, { body: 'after retention' }, 'message-key-3');
  await service.sendMessage('owner', groupId, { body: 'ignored retry body' }, 'message-key-3');
  const resumed = await service.listMessages('owner', groupId, next.nextCursor, '50');
  assert.deepEqual(resumed.messages.map((message) => message.body), ['after retention']);
  assert.equal(store.messages.length, 1);
  assert.equal((afterRetention.body as { message: { id: string } }).message.id, resumed.messages[0].id);
  const caughtUp = await service.listMessages('owner', groupId, resumed.nextCursor, '50');
  assert.deepEqual(caughtUp.messages, []);
});

test('oversized messages and invalid polling bounds are rejected', async () => {
  assert.throws(() => validateMessageBody('x'.repeat(1_001)), HttpError);
  const { service } = groupsFixture();
  const groupId = (await service.createGroup('owner', { name: 'Ride' })).group.id;
  await expectStatus(() => service.listMessages('owner', groupId, null, '51'), 400);
  await expectStatus(() => service.listMessages('owner', groupId, 'malformed', '5'), 400);
});

test('D1 invite redemption is atomic, single-use, and rejects expired groups', async () => {
  const { sqlite, store } = migratedD1Fixture();
  const now = 10_000;
  await store.createGroup({
    id: 'group-1',
    ownerUserId: 'owner',
    name: 'Ride',
    createdAt: now,
    expiresAt: now + 60_000,
  });
  assert.equal(await store.createInvite({
    id: 'invite-1',
    groupId: 'group-1',
    userId: 'owner',
    email: 'rider@example.com',
    tokenHash: 'token-1',
    createdAt: now,
    expiresAt: now + 30_000,
  }), true);

  const concurrent = await Promise.all([
    store.redeemInvite('token-1', 'rider-a', 'rider@example.com', now + 1),
    store.redeemInvite('token-1', 'rider-b', 'rider@example.com', now + 1),
  ]);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.equal(sqlite.database.prepare(
    "SELECT count(*) AS count FROM group_memberships WHERE group_id = 'group-1' AND role = 'member'",
  ).get()!.count, 1);

  assert.equal(await store.createInvite({
    id: 'invite-2',
    groupId: 'group-1',
    userId: 'owner',
    email: 'retry@example.com',
    tokenHash: 'token-2',
    createdAt: now,
    expiresAt: now + 30_000,
  }), true);
  sqlite.failBatchAt = 1;
  await assert.rejects(
    store.redeemInvite('token-2', 'rider-b', 'retry@example.com', now + 2),
    /simulated D1 batch failure/,
  );
  assert.equal(sqlite.database.prepare(
    "SELECT accepted_at FROM group_invites WHERE id = 'invite-2'",
  ).get()!.accepted_at, null);
  assert.equal(sqlite.database.prepare(
    "SELECT count(*) AS count FROM group_memberships WHERE group_id = 'group-1' AND user_id = 'rider-b'",
  ).get()!.count, 0);
  assert.ok(await store.redeemInvite('token-2', 'rider-b', 'retry@example.com', now + 3));

  sqlite.database.prepare("UPDATE groups SET expires_at = ? WHERE id = 'group-1'").run(now + 3);
  assert.equal(await store.createInvite({
    id: 'invite-3',
    groupId: 'group-1',
    userId: 'owner',
    email: 'late@example.com',
    tokenHash: 'token-3',
    createdAt: now + 4,
    expiresAt: now + 30_000,
  }), false);
  sqlite.database.close();
});

test('D1 message cursor survives retention deletion without reuse', async () => {
  const { sqlite, store } = migratedD1Fixture();
  const now = 20_000;
  await store.createGroup({
    id: 'group-1',
    ownerUserId: 'owner',
    name: 'Ride',
    createdAt: now,
    expiresAt: now + 60_000,
  });
  const save = (id: string, key: string, createdAt: number) => store.saveMessage(
    { id, groupId: 'group-1', userId: 'owner', body: id, createdAt },
    key,
    JSON.stringify({ message: { id } }),
    createdAt,
    createdAt + 60_000,
  );
  assert.equal(await save('message-1', 'key-1', now), true);
  assert.equal(await save('message-2', 'key-2', now + 1), true);
  const initial = await store.listMessages('owner', 'group-1', null, 50, now + 2);
  const cursor = initial.at(-1)!.sequence;
  assert.equal(cursor, 2);

  sqlite.database.exec('DELETE FROM messages');
  assert.equal(await save('message-3', 'key-3', now + 3), true);
  const resumed = await store.listMessages('owner', 'group-1', cursor, 50, now + 4);
  assert.deepEqual(resumed.map(({ id, sequence }) => ({ id, sequence })), [
    { id: 'message-3', sequence: 3 },
  ]);
  assert.deepEqual(await store.listMessages('owner', 'group-1', 3, 50, now + 4), []);
  sqlite.database.close();
});

test('D1 message operations enforce active membership in the guarded query', async () => {
  const { sqlite, store } = migratedD1Fixture();
  const now = 30_000;
  await store.createGroup({
    id: 'group-1',
    ownerUserId: 'owner',
    name: 'Ride',
    createdAt: now,
    expiresAt: now + 1,
  });
  assert.equal(await store.saveMessage(
    { id: 'expired-message', groupId: 'group-1', userId: 'owner', body: 'late', createdAt: now + 2 },
    'expired-key',
    '{}',
    now + 2,
    now + 60_000,
  ), false);
  assert.deepEqual(await store.listMessages('owner', 'group-1', null, 50, now + 2), []);
  assert.equal(sqlite.database.prepare('SELECT count(*) AS count FROM idempotency_records').get()!.count, 0);
  sqlite.database.close();
});
