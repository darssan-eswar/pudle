import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PudyAssistant,
  type PudyAssistantHandle,
  type PudyAssistantProps,
} from './PudyAssistant';

class MockRecognition {
  static instances: MockRecognition[] = [];
  static throwOnStart = false;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => {
    if (MockRecognition.throwOnStart) throw new Error('microphone unavailable');
  });
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockRecognition.instances.push(this);
  }

  result(transcript: string) {
    this.onresult?.({ results: [{ 0: { transcript } }] });
  }

  error(code: string) {
    this.onerror?.({ error: code });
  }
}

class MockUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly text: string) {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('button')]
    .find((item) => item.textContent?.includes(label));
  if (!match) throw new Error(`Missing button: ${label}`);
  return match as HTMLButtonElement;
}

function mount(overrides: Partial<PudyAssistantProps> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = createRef<PudyAssistantHandle>();
  const props: PudyAssistantProps = {
    enabled: true,
    sceneLabels: [],
    analysisLabels: [],
    nearbyLabels: [],
    onAction: vi.fn().mockResolvedValue('Action completed.'),
    ...overrides,
  };
  act(() => root.render(<PudyAssistant ref={ref} {...props} />));
  return { container, props, ref, root };
}

describe('PudyAssistant mocked browser speech lifecycle', () => {
  const speak = vi.fn();
  const cancel = vi.fn();

  beforeEach(() => {
    MockRecognition.instances = [];
    MockRecognition.throwOnStart = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.stubGlobal('SpeechRecognition', MockRecognition);
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel },
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    speak.mockReset();
    cancel.mockReset();
    vi.unstubAllGlobals();
  });

  it('invalidates a delayed action when stopped before it resolves', async () => {
    const action = deferred<string>();
    const mounted = mount({ onAction: vi.fn(() => action.promise) });
    act(() => button(mounted.container, 'Enable voice').click());
    await act(async () => {
      MockRecognition.instances[0].result('Hey Pudy save clip');
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain('thinking');

    act(() => mounted.ref.current?.stop());
    await act(async () => {
      action.resolve('Saved after sign-out.');
      await action.promise;
    });

    expect(speak).not.toHaveBeenCalled();
    expect(mounted.container.textContent).not.toContain('Saved after sign-out.');
    act(() => mounted.root.unmount());
  });

  it('lets a newer request supersede a delayed action response', async () => {
    const action = deferred<string>();
    const mounted = mount({ onAction: vi.fn(() => action.promise) });
    act(() => button(mounted.container, 'Enable voice').click());
    const active = MockRecognition.instances[0];
    await act(async () => {
      active.result('Hey Pudy save clip');
      await Promise.resolve();
    });
    const input = mounted.container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'what is visible?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    act(() => button(mounted.container, 'Ask').click());
    expect(speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      action.resolve('Stale save response.');
      await action.promise;
    });

    expect(speak).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).not.toContain('Stale save response.');
    act(() => mounted.root.unmount());
  });

  it('does not resume a delayed action after unmount', async () => {
    const action = deferred<string>();
    const mounted = mount({ onAction: vi.fn(() => action.promise) });
    act(() => button(mounted.container, 'Enable voice').click());
    await act(async () => {
      MockRecognition.instances[0].result('Hey Pudy save clip');
      await Promise.resolve();
    });
    act(() => mounted.root.unmount());
    await act(async () => {
      action.resolve('Saved after unmount.');
      await action.promise;
    });
    expect(speak).not.toHaveBeenCalled();
  });

  it('shows an honest error when an action rejects', async () => {
    const mounted = mount({
      onAction: vi.fn().mockRejectedValue(new Error('storage failed')),
    });
    act(() => button(mounted.container, 'Enable voice').click());
    await act(async () => {
      MockRecognition.instances[0].result('Hey Pudy save clip');
      await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain(
      'Pudy could not complete that action. Nothing was shared or saved.',
    );
    expect(speak).not.toHaveBeenCalled();
    act(() => mounted.root.unmount());
  });

  it('handles synchronous recognition start failures and hidden-tab cancellation', () => {
    MockRecognition.throwOnStart = true;
    const mounted = mount();
    act(() => button(mounted.container, 'Enable voice').click());
    expect(mounted.container.textContent).toContain('Listening could not start');

    MockRecognition.throwOnStart = false;
    act(() => button(mounted.container, 'Enable voice').click());
    const active = MockRecognition.instances.at(-1)!;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(active.abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
    expect(mounted.container.textContent).toContain('idle');
    act(() => mounted.root.unmount());
  });

  it('keeps listening across utterances and resumes after speech', async () => {
    const mounted = mount();
    act(() => button(mounted.container, 'Enable voice').click());
    const first = MockRecognition.instances[0];

    await act(async () => {
      first.result('traffic sounds');
      await Promise.resolve();
    });

    expect(MockRecognition.instances).toHaveLength(2);
    expect(mounted.container.textContent).toContain('Listening for “Hey Pudy.”');

    await act(async () => {
      MockRecognition.instances[1].result('Hey Pudy what is visible');
      await Promise.resolve();
    });
    expect(speak).toHaveBeenCalledOnce();
    expect(mounted.container.textContent).toContain('speaking');

    act(() => {
      const utterance = speak.mock.calls[0][0] as MockUtterance;
      utterance.onend?.();
    });
    expect(MockRecognition.instances).toHaveLength(3);
    expect(mounted.container.textContent).toContain('listening');
    act(() => mounted.root.unmount());
  });

  it('pauses while hidden, resumes when visible, and stays stopped after Stop voice', () => {
    const mounted = mount();
    act(() => button(mounted.container, 'Enable voice').click());
    const first = MockRecognition.instances[0];

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(first.abort).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(MockRecognition.instances).toHaveLength(2);

    act(() => button(mounted.container, 'Stop voice').click());
    expect(MockRecognition.instances[1].abort).toHaveBeenCalledOnce();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(MockRecognition.instances).toHaveLength(2);
    expect(mounted.container.textContent).toContain('Enable voice');
    act(() => mounted.root.unmount());
  });

  it('explains denied microphone permission and keeps text available', () => {
    const mounted = mount();
    act(() => button(mounted.container, 'Enable voice').click());
    act(() => MockRecognition.instances[0].error('not-allowed'));

    expect(mounted.container.textContent).toContain('Microphone permission was denied');
    expect((mounted.container.querySelector('input') as HTMLInputElement).disabled).toBe(false);
    expect(mounted.container.textContent).toContain('Enable voice');
    act(() => mounted.root.unmount());
  });
});
