import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEventsApi,
  NearbyPollController,
  roundEventCoordinates,
  type NearbyEvent,
} from './events';

const nearbyEvent: NearbyEvent = {
  id: 'event-1',
  type: 'object-on-road',
  confidence: 1,
  source: 'manual',
  createdAt: 1_000,
  expiresAt: 2_000,
  distanceBand: 'within-one-mile',
  canResolve: false,
  acknowledgedByMe: false,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('events client adapter', () => {
  it('rounds coordinates to three decimals before every coordinate request', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [nearbyEvent] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        event: { ...nearbyEvent, distanceBand: undefined },
      })));
    const api = createEventsApi(fetcher);
    const signal = new AbortController().signal;

    expect(roundEventCoordinates({ latitude: 40.12349, longitude: -73.98751 }))
      .toEqual({ latitude: 40.123, longitude: -73.988 });
    await api.nearby({ latitude: 40.12349, longitude: -73.98751 }, signal);
    await api.create({
      type: 'object-on-road',
      latitude: 40.12349,
      longitude: -73.98751,
    }, 'event-create-safe_key', signal);

    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/events?lat=40.123&lng=-73.988');
    const createRequest = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(createRequest.headers).toMatchObject({
      'X-Pudle-CSRF': '1',
      'Idempotency-Key': 'event-create-safe_key',
    });
    expect(JSON.parse(String(createRequest.body))).toEqual({
      type: 'object-on-road',
      latitude: 40.123,
      longitude: -73.988,
      source: 'manual',
    });
    expect(String(createRequest.body)).not.toContain('user');
  });

  it('uses CSRF and caller-owned idempotency keys for acknowledge and resolve', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ acknowledged: true })));
    const api = createEventsApi(fetcher);
    const signal = new AbortController().signal;
    await api.acknowledge('event/id', 'ack-key', signal);
    await api.resolve('event/id', 'resolve-key', signal);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/events/event%2Fid/ack',
      '/api/events/event%2Fid/resolve',
    ]);
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      'X-Pudle-CSRF': '1',
      'Idempotency-Key': 'ack-key',
    });
    expect((fetcher.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      'X-Pudle-CSRF': '1',
      'Idempotency-Key': 'resolve-key',
    });
  });

  it('maps only server-provided privacy distance bands and rejects exact-distance payloads', async () => {
    const validFetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events: [nearbyEvent] })),
    );
    await expect(createEventsApi(validFetcher).nearby(
      { latitude: 1, longitude: 2 },
      new AbortController().signal,
    )).resolves.toEqual([nearbyEvent]);

    const invalidFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      events: [{ ...nearbyEvent, distanceBand: undefined, distanceMiles: 0.4 }],
    })));
    await expect(createEventsApi(invalidFetcher).nearby(
      { latitude: 1, longitude: 2 },
      new AbortController().signal,
    )).rejects.toThrow(/unreadable/);
  });
});

describe('nearby poll controller', () => {
  it('clamps cadence to four seconds, deduplicates in-flight work, and aborts on stop', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const task = vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const poller = new NearbyPollController(task, 100);
    expect(poller.intervalMs).toBe(4_000);
    poller.start();
    poller.start();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    poller.retry();
    expect(task).toHaveBeenCalledTimes(1);
    poller.stop();
    expect(signal?.aborted).toBe(true);
    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('schedules the next poll four seconds from the prior start', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockResolvedValue(undefined);
    const poller = new NearbyPollController(task);
    poller.start();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
