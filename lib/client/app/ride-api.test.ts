import { describe, expect, it, vi } from 'vitest';
import { createRideApi, RideApiError } from './ride-api';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ride API', () => {
  it('creates an invite and redeems it as the authenticated second browser without user IDs', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url.endsWith('/invites')) {
        return json({ invite: { token: 'invite-token-long-enough', expiresAt: 2_000 } }, 201);
      }
      return json({ membership: { groupId: 'group_1' } });
    }) as typeof fetch;
    const api = createRideApi(fetcher);

    const invite = await api.createInvite('group_1', 'second@example.com');
    const membership = await api.redeemInvite(invite.token);

    expect(membership).toEqual({ groupId: 'group_1' });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(new Headers(call.init.headers).get('X-Pudle-CSRF')).toBe('1');
      expect(call.init.credentials).toBe('same-origin');
      expect(JSON.stringify(call.init.body)).not.toMatch(/userId|user_id/i);
    }
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ token: invite.token });
  });

  it('sends persisted plain text with an idempotency key and advances a cursor', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        message: { id: 'message_1', body: '<img src=x onerror=alert(1)>', createdAt: 10 },
      }, 201))
      .mockResolvedValueOnce(json({
        messages: [{
          id: 'message_1',
          body: '<img src=x onerror=alert(1)>',
          displayName: 'Alex',
          createdAt: 10,
        }],
        nextCursor: '42',
      }));
    const api = createRideApi(fetcher as typeof fetch);

    const sent = await api.sendMessage(
      'group_1',
      '<img src=x onerror=alert(1)>',
      'ride-message-key-123',
    );
    const page = await api.listMessages('group_1', '41');

    expect(sent.body).toBe('<img src=x onerror=alert(1)>');
    expect(page.nextCursor).toBe('42');
    const sendInit = fetcher.mock.calls[0][1] as RequestInit;
    expect(new Headers(sendInit.headers).get('Idempotency-Key')).toBe('ride-message-key-123');
    expect(new Headers(sendInit.headers).get('X-Pudle-CSRF')).toBe('1');
    expect(fetcher.mock.calls[1][0]).toBe('/api/groups/group_1/messages?limit=50&cursor=41');
  });

  it('adds CSRF to every mutation but not reads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ groups: [] }))
      .mockResolvedValueOnce(json({
        group: { id: 'g1', name: 'Morning', role: 'owner', joinedAt: 1 },
      }, 201))
      .mockResolvedValueOnce(json({ left: true }));
    const api = createRideApi(fetcher as typeof fetch);

    await api.listGroups();
    await api.createGroup('Morning');
    await api.leaveGroup('g1');

    expect(new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).has('X-Pudle-CSRF')).toBe(false);
    expect(new Headers((fetcher.mock.calls[1][1] as RequestInit).headers).get('X-Pudle-CSRF')).toBe('1');
    expect(new Headers((fetcher.mock.calls[2][1] as RequestInit).headers).get('X-Pudle-CSRF')).toBe('1');
  });

  it('surfaces server errors and rejects malformed or oversized responses', async () => {
    const forbidden = createRideApi(vi.fn(async () =>
      json({ error: 'Only the group owner may create invites.' }, 403)) as typeof fetch);
    await expect(forbidden.createInvite('group_1', 'a@example.com')).rejects.toEqual(
      expect.objectContaining({ message: 'Only the group owner may create invites.', status: 403 }),
    );

    const malformed = createRideApi(vi.fn(async () =>
      json({ groups: [{ id: 'g1', name: 'Ride', role: 'owner', joinedAt: 'yesterday' }] })) as typeof fetch);
    await expect(malformed.listGroups()).rejects.toBeInstanceOf(RideApiError);

    const oversized = createRideApi(vi.fn(async () =>
      new Response('{}', { headers: { 'Content-Length': '999999' } })) as typeof fetch);
    await expect(oversized.listGroups()).rejects.toThrow('too large');

    const dishonestLength = createRideApi(vi.fn(async () =>
      new Response(JSON.stringify({ groups: [], padding: '€'.repeat(50_000) }), {
        headers: { 'Content-Length': '2' },
      })) as typeof fetch);
    await expect(dishonestLength.listGroups()).rejects.toThrow('too large');
  });
});
