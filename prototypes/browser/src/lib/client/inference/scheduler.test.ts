import { describe, expect, it, vi } from 'vitest';
import type {
  LocalModelAdapter,
  LocalObservation,
} from './contracts';
import { LocalInferenceScheduler } from './scheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function adapter(overrides: Partial<LocalModelAdapter<string>> = {}) {
  return {
    source: 'local-model' as const,
    model: 'test-model',
    capability: () => ({ supported: true }),
    load: vi.fn(async () => undefined),
    infer: vi.fn(async () => [] as LocalObservation[]),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('LocalInferenceScheduler', () => {
  it('publishes capability, loading, ready, and bounded result metadata', async () => {
    let now = 10;
    const states: string[] = [];
    const results: unknown[] = [];
    const pendingLoad = deferred<void>();
    const pendingInference = deferred<LocalObservation[]>();
    const model = adapter({
      load: vi.fn(() => pendingLoad.promise),
      infer: vi.fn(() => pendingInference.promise),
    });
    const scheduler = new LocalInferenceScheduler(model, {
      minimumIntervalMs: 1_500,
      now: () => now,
      onState: (state) => states.push(state.status),
      onResult: (result) => results.push(result),
    });

    expect(scheduler.state).toEqual({
      status: 'capability',
      capability: { supported: true },
    });
    const loading = scheduler.start();
    expect(scheduler.state.status).toBe('loading');
    pendingLoad.resolve();
    await expect(loading).resolves.toBe(true);
    expect(scheduler.state.status).toBe('ready');

    now = 100;
    const first = scheduler.run('frame-a', 90);
    await expect(scheduler.run('frame-b', 91)).resolves.toBe(false);
    now = 124;
    pendingInference.resolve([{ label: 'car', confidence: 0.9 }]);
    await expect(first).resolves.toBe(true);
    expect(results).toEqual([
      {
        observations: [{ label: 'car', confidence: 0.9 }],
        source: 'local-model',
        model: 'test-model',
        capturedAt: 90,
        analyzedAt: 124,
        latencyMs: 24,
      },
    ]);
    await expect(scheduler.run('too-soon', 1_589)).resolves.toBe(false);
    expect(states).toEqual(['loading', 'ready', 'ready']);
  });

  it('aborts and discards late inference after cleanup', async () => {
    const pending = deferred<LocalObservation[]>();
    let signal: AbortSignal | undefined;
    const model = adapter({
      infer: vi.fn((_input, observedSignal) => {
        signal = observedSignal;
        return pending.promise;
      }),
    });
    const onResult = vi.fn();
    const scheduler = new LocalInferenceScheduler(model, { onResult });
    await scheduler.start();
    const inference = scheduler.run('frame');

    scheduler.stop();
    expect(signal?.aborted).toBe(true);
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(scheduler.state.status).toBe('capability');
    pending.resolve([{ label: 'late', confidence: 1 }]);
    await expect(inference).resolves.toBe(false);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('does not reload when a waiting restart is cancelled again', async () => {
    const pending = deferred<LocalObservation[]>();
    const model = adapter({
      infer: vi.fn(() => pending.promise),
    });
    const scheduler = new LocalInferenceScheduler(model);
    await scheduler.start();
    const inference = scheduler.run('frame');
    scheduler.stop();
    const restart = scheduler.start();
    scheduler.stop();

    pending.resolve([]);
    await expect(inference).resolves.toBe(false);
    await expect(restart).resolves.toBe(false);
    expect(model.load).toHaveBeenCalledTimes(1);
    expect(scheduler.state.status).toBe('capability');
  });

  it('reports unsupported capability and load errors without inference', async () => {
    const unsupported = adapter({
      capability: () => ({ supported: false, reason: 'No browser runtime.' }),
    });
    const unsupportedScheduler = new LocalInferenceScheduler(unsupported);
    await expect(unsupportedScheduler.start()).resolves.toBe(false);
    expect(unsupportedScheduler.state).toMatchObject({
      status: 'error',
      message: 'No browser runtime.',
    });
    expect(unsupported.load).not.toHaveBeenCalled();

    const broken = adapter({
      load: vi.fn(async () => {
        throw new Error('Model files are unavailable.');
      }),
    });
    const brokenScheduler = new LocalInferenceScheduler(broken);
    await expect(brokenScheduler.start()).resolves.toBe(false);
    expect(brokenScheduler.state).toMatchObject({
      status: 'error',
      message: 'Model files are unavailable.',
    });
  });
});
