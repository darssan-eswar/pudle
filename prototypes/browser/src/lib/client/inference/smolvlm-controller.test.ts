import { describe, expect, it, vi } from 'vitest';
import {
  SMOLVLM_MODEL,
  SMOLVLM_REVISION,
  type SmolVlmFrame,
  type SmolVlmWorkerRequest,
} from './smolvlm-contract';
import {
  SmolVlmController,
  type SmolVlmWorkerPort,
} from './smolvlm-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeWorker implements SmolVlmWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: SmolVlmWorkerRequest[] = [];
  transfers: Transferable[][] = [];
  terminated = false;

  postMessage(message: SmolVlmWorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function frame(): SmolVlmFrame {
  return {
    pixels: new Uint8ClampedArray(4 * 2 * 2),
    width: 2,
    height: 2,
    capturedAt: 900,
  };
}

describe('SmolVlmController', () => {
  it('allows only one load while capability checking is pending', async () => {
    const capability = deferred<{ supported: true }>();
    const workerFactory = vi.fn(() => new FakeWorker());
    const controller = new SmolVlmController({ capability: () => capability.promise, workerFactory });
    const first = controller.load(true);
    await expect(controller.load(true)).resolves.toBe(false);
    capability.resolve({ supported: true });
    await expect(first).resolves.toBe(true);
    expect(workerFactory).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('ignores queued callbacks from a replaced worker', async () => {
    const oldWorker = new FakeWorker();
    const newWorker = new FakeWorker();
    let calls = 0;
    const controller = new SmolVlmController({ capability: async () => ({ supported: true }),
      workerFactory: () => calls++ ? newWorker : oldWorker });
    await controller.load(true);
    const oldMessage = oldWorker.onmessage;
    controller.unload();
    await controller.load(true);
    oldMessage?.({ data: { type: 'ready' } } as MessageEvent);
    expect(controller.state.status).toBe('loading');
    newWorker.emit({ type: 'ready' });
    expect(controller.state.status).toBe('ready');
    controller.dispose();
  });
  it.each(['construct', 'send'])('handles %s startup failures without leaking a worker', async (failure) => {
    const worker = new FakeWorker();
    if (failure === 'send') worker.postMessage = () => { throw new Error('Blocked'); };
    const controller = new SmolVlmController({
      capability: async () => ({ supported: true }),
      workerFactory: () => {
        if (failure === 'construct') throw new Error('Worker blocked');
        return worker;
      },
    });
    await expect(controller.load(true)).resolves.toBe(false);
    expect(controller.state).toMatchObject({ status: 'error' });
    if (failure === 'send') expect(worker.terminated).toBe(true);
  });

  it('does not create a worker without explicit download consent', async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const controller = new SmolVlmController({
      capability: async () => ({ supported: true }),
      workerFactory,
    });

    await expect(controller.load(false)).resolves.toBe(false);
    expect(workerFactory).not.toHaveBeenCalled();
    expect(controller.state).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Confirm'),
    });
  });

  it('reports an unsupported WebGPU capability without downloading', async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const controller = new SmolVlmController({
      capability: async () => ({ supported: false, reason: 'No shader-f16.' }),
      workerFactory,
    });

    await expect(controller.checkCapability()).resolves.toBe(false);
    expect(controller.state).toEqual({
      status: 'unsupported',
      message: 'No shader-f16.',
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('loads, publishes progress, and allows exactly one generation at a time', async () => {
    const worker = new FakeWorker();
    let now = 1_000;
    const controller = new SmolVlmController({
      capability: async () => ({ supported: true }),
      workerFactory: () => worker,
      createId: () => 'request-1',
      now: () => now,
    });

    await expect(controller.load(true)).resolves.toBe(true);
    expect(worker.messages).toEqual([{ type: 'load' }]);
    worker.emit({
      type: 'progress',
      progress: 40,
      downloadedBytes: 40,
      totalBytes: 100,
      file: 'weights.onnx',
    });
    expect(controller.state).toMatchObject({ status: 'loading', progress: 40 });
    worker.emit({ type: 'ready' });

    const input = frame();
    expect(controller.describe(input)).toBe(true);
    expect(controller.describe(frame())).toBe(false);
    expect(worker.messages[1]).toMatchObject({
      type: 'describe',
      requestId: 'request-1',
      width: 2,
      height: 2,
    });
    expect(worker.transfers[1]).toEqual([input.pixels.buffer]);

    now = 1_125;
    worker.emit({
      type: 'result',
      requestId: 'request-1',
      description: 'A dry road with a parked car is visible.',
    });
    expect(controller.state).toEqual({
      status: 'ready',
      result: {
        description: 'A dry road with a parked car is visible.',
        source: 'local-model',
        model: SMOLVLM_MODEL,
        revision: SMOLVLM_REVISION,
        capturedAt: 900,
        analyzedAt: 1_125,
        latencyMs: 125,
      },
    });
    expect(worker.terminated).toBe(false);
  });

  it('hard-terminates the worker on timeout and manual unload', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    let workerIndex = 0;
    let timeout: (() => void) | undefined;
    const controller = new SmolVlmController({
      capability: async () => ({ supported: true }),
      workerFactory: () => workers[workerIndex++]!,
      createId: () => 'request',
      setTimer: (callback) => {
        timeout = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
    });

    await controller.load(true);
    firstWorker.emit({ type: 'ready' });
    expect(controller.describe(frame())).toBe(true);
    timeout?.();
    expect(firstWorker.terminated).toBe(true);
    expect(controller.state).toMatchObject({
      status: 'error',
      message: expect.stringContaining('timed out'),
    });
    await controller.load(true);
    await controller.load(true);
    secondWorker.emit({ type: 'ready' });
    controller.unload('Stopped.');
    expect(secondWorker.terminated).toBe(true);
    expect(controller.state).toEqual({ status: 'idle', message: 'Stopped.' });
  });

  it('discards prohibited model output and ignores a late capability result after disposal', async () => {
    const worker = new FakeWorker();
    const capability = deferred<{ supported: true }>();
    const controller = new SmolVlmController({
      capability: () => capability.promise,
      workerFactory: () => worker,
      createId: () => 'request',
    });
    const checking = controller.checkCapability();
    controller.dispose();
    capability.resolve({ supported: true });
    await expect(checking).resolves.toBe(false);
    expect(controller.state.status).toBe('checking');

    const loaded = new SmolVlmController({
      capability: async () => ({ supported: true }),
      workerFactory: () => worker,
      createId: () => 'request',
    });
    await loaded.load(true);
    worker.emit({ type: 'ready' });
    loaded.describe(frame());
    worker.emit({
      type: 'result',
      requestId: 'request',
      description: 'The drunk owner is at fault.',
    });
    expect(worker.terminated).toBe(true);
    expect(loaded.state).toMatchObject({
      status: 'error',
      message: expect.stringContaining('prohibited inference'),
    });
  });
});
