import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NearbyEvents } from './NearbyEvents';
import type { EventsApi, NearbyEvent } from '@/lib/client/app';

const event: NearbyEvent = {
  id: 'event-1',
  type: 'flooding',
  confidence: 1,
  source: 'manual',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  distanceBand: 'within-half-mile',
  canResolve: false,
  acknowledgedByMe: false,
};

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('button')]
    .find((item) => item.textContent?.includes(label));
  if (!match) throw new Error(`Missing button: ${label}`);
  return match as HTMLButtonElement;
}

function apiFixture(overrides: Partial<EventsApi> = {}): EventsApi {
  return {
    nearby: vi.fn().mockResolvedValue([event]),
    create: vi.fn().mockResolvedValue(event),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function mount(options: {
  api?: EventsApi;
  preparedByPudy?: boolean;
  online?: boolean;
  demoModeEnabled?: boolean;
} = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const api = options.api ?? apiFixture();
  const onPreparedHandled = vi.fn();
  const onNearbyLabelsChange = vi.fn();
  await act(async () => {
    root.render(
      <NearbyEvents
        active
        online={options.online ?? true}
        currentUserId="user-1"
        demoModeEnabled={options.demoModeEnabled}
        preparedByPudy={options.preparedByPudy ?? false}
        onPreparedHandled={onPreparedHandled}
        onNearbyLabelsChange={onNearbyLabelsChange}
        api={api}
      />,
    );
  });
  return { api, container, root, onPreparedHandled, onNearbyLabelsChange };
}

async function grantLocation(container: HTMLElement) {
  await act(async () => button(container, 'Share approximate location').click());
  await act(async () => Promise.resolve());
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('nearby events permission and report flow', () => {
  it('uses the fixed demo area without requesting device location when enabled', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const api = apiFixture();
    const mounted = await mount({ api, demoModeEnabled: true });

    await act(async () => button(mounted.container, 'Use demo area').click());
    await act(async () => Promise.resolve());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(api.nearby).toHaveBeenCalledWith(
      { latitude: 40.713, longitude: -74.006 },
      expect.any(AbortSignal),
    );
    expect(mounted.container.textContent).toContain('fixed coarse test location');
    act(() => mounted.root.unmount());
  });

  it('does not request location until the explicit rationale control is used', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const mounted = await mount();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain('Location stays off');
    act(() => button(mounted.container, 'Share approximate location').click());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    act(() => mounted.root.unmount());
  });

  it('shows actionable denied state without polling', async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({
      code: 1,
      PERMISSION_DENIED: 1,
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const mounted = await mount();
    await grantLocation(mounted.container);
    expect(mounted.container.textContent).toContain('Allow approximate location in browser settings');
    expect(button(mounted.container, 'Try location again')).toBeTruthy();
    expect(mounted.api.nearby).not.toHaveBeenCalled();
    act(() => mounted.root.unmount());
  });

  it('prepares from Pudy but never posts until explicit confirmation', async () => {
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40.12349, longitude: -73.98751 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const api = apiFixture();
    const mounted = await mount({ api, preparedByPudy: true });
    expect(api.create).not.toHaveBeenCalled();
    await grantLocation(mounted.container);
    expect(mounted.container.textContent).toContain('Nothing is shared until you confirm');
    expect(api.create).not.toHaveBeenCalled();
    await act(async () => button(mounted.container, 'Confirm and share').click());
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(mounted.onPreparedHandled).toHaveBeenCalledTimes(1);
    act(() => mounted.root.unmount());
  });

  it('acknowledges every report but exposes resolve only for a report created in this session', async () => {
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40, longitude: -74 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const api = apiFixture({
      nearby: vi.fn()
        .mockResolvedValueOnce([event])
        .mockResolvedValue([{ ...event, canResolve: true }]),
    });
    const mounted = await mount({ api });
    await grantLocation(mounted.container);
    expect(button(mounted.container, 'Acknowledge')).toBeTruthy();
    expect(mounted.container.textContent).not.toContain('Resolve my report');

    act(() => button(mounted.container, 'Prepare a road report').click());
    await act(async () => button(mounted.container, 'Confirm and share').click());
    await vi.waitFor(() =>
      expect(mounted.container.textContent).toContain('Resolve my report'),
    );

    await act(async () => button(mounted.container, 'Acknowledge').click());
    expect(api.acknowledge).toHaveBeenCalledWith(
      'event-1',
      expect.stringMatching(/^event-ack-[A-Za-z0-9-]+$/),
      expect.any(AbortSignal),
    );
    act(() => mounted.root.unmount());
  });

  it('restores owner and acknowledgement controls from a fresh server response', async () => {
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40, longitude: -74 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const api = apiFixture({
      nearby: vi.fn().mockResolvedValue([{
        ...event,
        canResolve: true,
        acknowledgedByMe: true,
      }]),
    });
    const mounted = await mount({ api });

    await grantLocation(mounted.container);

    expect(mounted.container.textContent).toContain('Resolve my report');
    expect(button(mounted.container, 'Acknowledged').disabled).toBe(true);
    act(() => mounted.root.unmount());
  });

  it('pauses polling offline and clears fresh labels on unmount', async () => {
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40, longitude: -74 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const mounted = await mount({ online: false });
    await grantLocation(mounted.container);
    expect(mounted.container.textContent).toContain('Offline');
    expect(mounted.api.nearby).not.toHaveBeenCalled();
    act(() => mounted.root.unmount());
    expect(mounted.onNearbyLabelsChange).toHaveBeenLastCalledWith([]);
  });

  it('aborts an in-flight nearby request on unmount', async () => {
    let observedSignal: AbortSignal | undefined;
    const api = apiFixture({
      nearby: vi.fn((_coordinates, signal) => {
        observedSignal = signal;
        return new Promise<NearbyEvent[]>(() => undefined);
      }),
    });
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40, longitude: -74 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const mounted = await mount({ api });
    await grantLocation(mounted.container);
    expect(observedSignal?.aborted).toBe(false);
    act(() => mounted.root.unmount());
    expect(observedSignal?.aborted).toBe(true);
  });

  it('preserves the create idempotency key when retrying the same report', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce(event);
    const api = apiFixture({ create });
    const getCurrentPosition = vi.fn((success) => success({
      coords: { latitude: 40, longitude: -74 },
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const mounted = await mount({ api });
    await grantLocation(mounted.container);
    act(() => button(mounted.container, 'Prepare a road report').click());
    await act(async () => button(mounted.container, 'Confirm and share').click());
    expect(mounted.container.textContent).toContain('Temporary error');
    await act(async () => button(mounted.container, 'Retry same request').click());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[1]).toBe(create.mock.calls[0]?.[1]);
    act(() => mounted.root.unmount());
  });
});
