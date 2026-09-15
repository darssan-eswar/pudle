import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RideApi,
  RideGroup,
  RideMessagePage,
} from '../../lib/client/app/ride-api';
import { AppRide, type AppRideUser } from './AppRide';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const group: RideGroup = {
  id: 'group_1',
  name: 'School run',
  role: 'owner',
  joinedAt: 1,
};

function mockApi(overrides: Partial<RideApi> = {}): RideApi {
  return {
    listGroups: vi.fn(async () => [group]),
    createGroup: vi.fn(async (name: string) => ({ ...group, name })),
    createInvite: vi.fn(async () => ({ token: 'invite-token-long-enough', expiresAt: 2_000 })),
    redeemInvite: vi.fn(async () => ({ groupId: group.id })),
    leaveGroup: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    sendMessage: vi.fn(async (_groupId: string, body: string) => ({ id: 'sent_1', body, createdAt: 10 })),
    ...overrides,
  };
}

function mount(api: RideApi, user: AppRideUser = { id: 'user_1', displayName: 'Alex' }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<AppRide currentUser={user} api={api} pollIntervalMs={3_000} />));
  return {
    container,
    root,
    rerender(nextUser: AppRideUser) {
      act(() => root.render(<AppRide currentUser={nextUser} api={api} pollIntervalMs={3_000} />));
    },
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')]
    .find((item) => item.textContent?.includes(label));
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const result = [...container.querySelectorAll('label')].find((item) =>
    item.textContent?.includes(label))?.querySelector('input');
  if (!result) throw new Error(`Missing input: ${label}`);
  return result;
}

function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AppRide', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('polls with a stable cursor, dedupes opaque IDs, pauses offline, and reconnects', async () => {
    vi.useFakeTimers();
    const first = deferred<RideMessagePage>();
    const listMessages = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        messages: [
          { id: 'opaque_a', body: 'First', displayName: 'Alex', createdAt: 1 },
          { id: 'opaque_b', body: 'Second', displayName: 'Blair', createdAt: 2 },
        ],
        nextCursor: '4',
      })
      .mockResolvedValue({
        messages: [{ id: 'opaque_b', body: 'Second', displayName: 'Blair', createdAt: 2 }],
        nextCursor: '3',
      });
    const mounted = mount(mockApi({ listMessages }));
    await settle();

    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(listMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({
        messages: [
          { id: 'opaque_a', body: 'First', displayName: 'Alex', createdAt: 1 },
          { id: 'opaque_a', body: 'First', displayName: 'Alex', createdAt: 1 },
        ],
        nextCursor: '3',
      });
      await first.promise;
    });
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(listMessages).toHaveBeenNthCalledWith(2, group.id, '3', expect.any(AbortSignal));
    expect(mounted.container.querySelectorAll('ol[aria-label="Ride messages"] li')).toHaveLength(2);

    setOnline(false);
    act(() => window.dispatchEvent(new Event('offline')));
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(listMessages).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toContain('Messages are paused while offline');

    setOnline(true);
    act(() => window.dispatchEvent(new Event('online')));
    await settle();
    expect(listMessages).toHaveBeenNthCalledWith(3, group.id, '4', expect.any(AbortSignal));
    expect(mounted.container.querySelectorAll('ol[aria-label="Ride messages"] li')).toHaveLength(2);

    act(() => mounted.root.unmount());
  });

  it('renders malicious message text without creating markup', async () => {
    const body = '<img src=x onerror="alert(1)"><script>bad()</script>';
    const api = mockApi({
      listMessages: vi.fn(async () => ({
        messages: [{ id: 'opaque_1', body, displayName: 'Blair', createdAt: 1 }],
        nextCursor: '1',
      })),
    });
    const mounted = mount(api);
    await settle();

    expect(mounted.container.textContent).toContain(body);
    expect(mounted.container.querySelector('img')).toBeNull();
    expect(mounted.container.querySelector('script')).toBeNull();
    act(() => mounted.root.unmount());
  });

  it('presents the active conversation with message hierarchy and collapsed management', async () => {
    const api = mockApi({
      listMessages: vi.fn(async () => ({
        messages: [
          { id: 'opaque_1', body: 'Meet at the north gate', displayName: 'Blair', createdAt: 1 },
          { id: 'opaque_2', body: 'On my way', displayName: 'Alex', createdAt: 2 },
        ],
        nextCursor: '2',
      })),
    });
    const mounted = mount(api);
    await settle();

    const conversation = mounted.container.querySelector('.app-ride__conversation');
    expect(conversation?.querySelector('h2')?.textContent).toBe('School run');
    expect(conversation?.textContent).toContain('Active conversation');

    const messageItems = conversation?.querySelectorAll('ol[aria-label="Ride messages"] li');
    expect(messageItems).toHaveLength(2);
    expect(messageItems?.[0].querySelector('.app-ride__sender')?.textContent).toBe('Blair');
    expect(messageItems?.[0].querySelector('.app-ride__message-body')?.textContent)
      .toBe('Meet at the north gate');
    expect(messageItems?.[0].querySelector('time')?.getAttribute('datetime')).toBeTruthy();
    expect(messageItems?.[1].classList.contains('app-ride__message--own')).toBe(true);

    const management = conversation?.querySelector('details');
    const summary = management?.querySelector('summary');
    expect(summary?.textContent).toBe('Manage ride groups');
    expect(management?.hasAttribute('open')).toBe(false);
    expect(management?.querySelector('button')?.textContent).toContain('School run');

    act(() => summary?.click());
    expect(management?.hasAttribute('open')).toBe(true);
    expect(conversation?.querySelector('form.app-ride__composer textarea')).toBeTruthy();

    act(() => mounted.root.unmount());
  });

  it('keeps create and join onboarding obvious when there is no selected group', async () => {
    const mounted = mount(mockApi({
      listGroups: vi.fn(async () => []),
    }));
    await settle();

    const onboarding = mounted.container.querySelector('.app-ride__onboarding');
    expect(onboarding?.querySelector('h2')?.textContent).toBe('Start or join a ride');
    expect(button(onboarding as HTMLElement, 'Create group')).toBeTruthy();
    expect(button(onboarding as HTMLElement, 'Join group')).toBeTruthy();
    expect(mounted.container.querySelector('.app-ride__management')).toBeNull();

    act(() => mounted.root.unmount());
  });

  it('aborts group requests on account change and polling on unmount', async () => {
    const groupSignals: AbortSignal[] = [];
    const messageSignals: AbortSignal[] = [];
    const api = mockApi({
      listGroups: vi.fn(async (signal?: AbortSignal) => {
        if (signal) groupSignals.push(signal);
        return [group];
      }),
      listMessages: vi.fn((_groupId: string, _cursor: string | null, signal?: AbortSignal) => {
        if (signal) messageSignals.push(signal);
        return new Promise<RideMessagePage>(() => undefined);
      }),
    });
    const mounted = mount(api);
    await settle();
    expect(messageSignals[0]?.aborted).toBe(false);

    mounted.rerender({ id: 'user_2', displayName: 'Blair' });
    expect(groupSignals[0]?.aborted).toBe(true);
    expect(messageSignals[0]?.aborted).toBe(true);
    await settle();

    act(() => mounted.root.unmount());
    expect(groupSignals.at(-1)?.aborted).toBe(true);
    expect(messageSignals.at(-1)?.aborted).toBe(true);
  });

  it('creates and copies an invite, sends a message, and exposes actionable errors', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const createInvite = vi.fn(async () => ({
      token: 'invite-token-long-enough',
      expiresAt: 2_000,
    }));
    const sendMessage = vi.fn(async (_groupId: string, body: string) => ({
      id: 'sent_1',
      body,
      createdAt: 10,
    }));
    const api = mockApi({ createInvite, sendMessage });
    const mounted = mount(api);
    await settle();

    await act(async () => {
      change(inputByLabel(mounted.container, 'Email to invite'), 'second@example.com');
    });
    act(() => button(mounted.container, 'Create invite').click());
    await settle();
    expect(createInvite).toHaveBeenCalledWith(group.id, 'second@example.com', expect.any(AbortSignal));
    expect(mounted.container.textContent).toContain('owner cannot leave');
    expect([...mounted.container.querySelectorAll('button')].some((item) =>
      item.textContent?.includes('Leave group'))).toBe(false);
    act(() => button(mounted.container, 'Copy code').click());
    await settle();
    expect(writeText).toHaveBeenCalledWith('invite-token-long-enough');

    const textarea = mounted.container.querySelector('textarea');
    if (!textarea) throw new Error('Missing message field');
    await act(async () => change(textarea, 'Road is clear'));
    act(() => button(mounted.container, 'Send message').click());
    await settle();
    expect(sendMessage).toHaveBeenCalledWith(
      group.id,
      'Road is clear',
      expect.stringMatching(/^ride-/),
      expect.any(AbortSignal),
    );
    expect(mounted.container.textContent).toContain('Road is clear');

    act(() => mounted.root.unmount());

    const failing = mount(mockApi({
      listGroups: vi.fn(async () => {
        throw new Error('Groups unavailable.');
      }),
    }));
    await settle();
    expect(failing.container.querySelector('[role="alert"]')?.textContent).toContain('Groups unavailable.');
    expect(button(failing.container, 'Retry groups')).toBeTruthy();
    act(() => failing.root.unmount());
  });
});
