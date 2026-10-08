import smolVlmWorkerUrl from './smolvlm.worker.ts?worker&url';
import {
  SMOLVLM_INFERENCE_TIMEOUT_MS,
  SMOLVLM_MODEL,
  SMOLVLM_REVISION,
  type SmolVlmCapability,
  type SmolVlmFrame,
  type SmolVlmState,
  type SmolVlmWorkerRequest,
  type SmolVlmWorkerResponse,
  validateSmolVlmDescription,
  validateSmolVlmFrame,
} from './smolvlm-contract';

export interface SmolVlmWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SmolVlmWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

interface SmolVlmControllerOptions {
  workerFactory?: () => SmolVlmWorkerPort;
  capability?: () => Promise<SmolVlmCapability>;
  onState?: (state: SmolVlmState) => void;
  now?: () => number;
  createId?: () => string;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  timeoutMs?: number;
}

interface ActiveRequest {
  id: string;
  capturedAt: number;
  startedAt: number;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<{
      features: { has(feature: string): boolean };
    } | null>;
  };
}

export async function checkSmolVlmCapability(): Promise<SmolVlmCapability> {
  if (typeof navigator === 'undefined') {
    return { supported: false, reason: 'Local descriptions require a browser with WebGPU.' };
  }
  const gpu = (navigator as unknown as NavigatorWithGpu).gpu;
  if (!gpu) {
    return { supported: false, reason: 'This browser does not expose WebGPU.' };
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No WebGPU adapter is available on this device.' };
    }
    if (!adapter.features.has('shader-f16')) {
      return {
        supported: false,
        reason: 'This WebGPU device does not support the shader-f16 feature required by the local model.',
      };
    }
    return { supported: true };
  } catch {
    return { supported: false, reason: 'WebGPU capability could not be checked.' };
  }
}

export function createSmolVlmWorker(): Worker {
  // A bundled URL avoids Vinext rewriting import.meta.url to a file: URL.
  return new Worker(smolVlmWorkerUrl, {
    type: 'module',
    name: 'pudle-smolvlm',
  });
}

function isWorkerResponse(value: unknown): value is SmolVlmWorkerResponse {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready') return true;
  if (message.type === 'progress') {
    return (
      typeof message.progress === 'number'
      && Number.isFinite(message.progress)
      && (message.downloadedBytes === undefined
        || (typeof message.downloadedBytes === 'number'
          && Number.isFinite(message.downloadedBytes)
          && message.downloadedBytes >= 0))
      && (message.totalBytes === undefined
        || (typeof message.totalBytes === 'number'
          && Number.isFinite(message.totalBytes)
          && message.totalBytes >= 0))
      && (message.file === undefined || typeof message.file === 'string')
    );
  }
  if (message.type === 'result') {
    return typeof message.requestId === 'string' && typeof message.description === 'string';
  }
  if (message.type === 'error') {
    return (
      typeof message.message === 'string'
      && (message.requestId === undefined || typeof message.requestId === 'string')
    );
  }
  return false;
}

export class SmolVlmController {
  private readonly options: Required<
    Pick<
      SmolVlmControllerOptions,
      'workerFactory' | 'capability' | 'now' | 'createId' | 'setTimer' | 'clearTimer' | 'timeoutMs'
    >
  > & Pick<SmolVlmControllerOptions, 'onState'>;
  private worker: SmolVlmWorkerPort | null = null;
  private activeRequest: ActiveRequest | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private capabilityResult: SmolVlmCapability | null = null;
  private currentState: SmolVlmState = { status: 'checking' };
  private generation = 0;
  private loadPending = false;

  constructor(options: SmolVlmControllerOptions = {}) {
    this.options = {
      workerFactory: options.workerFactory ?? createSmolVlmWorker,
      capability: options.capability ?? checkSmolVlmCapability,
      onState: options.onState,
      now: options.now ?? Date.now,
      createId: options.createId ?? (() => crypto.randomUUID()),
      setTimer: options.setTimer ?? setTimeout,
      clearTimer: options.clearTimer ?? clearTimeout,
      timeoutMs: options.timeoutMs ?? SMOLVLM_INFERENCE_TIMEOUT_MS,
    };
  }

  get state(): SmolVlmState {
    return this.currentState;
  }

  async checkCapability(): Promise<boolean> {
    const generation = this.generation;
    this.publish({ status: 'checking' });
    let capability: SmolVlmCapability;
    try {
      capability = await this.options.capability();
    } catch {
      capability = {
        supported: false,
        reason: 'WebGPU capability could not be checked.',
      };
    }
    if (generation !== this.generation) return false;
    this.capabilityResult = capability;
    if (!capability.supported) {
      this.publish({
        status: 'unsupported',
        message: capability.reason ?? 'Local descriptions are unsupported on this device.',
      });
      return false;
    }
    this.publish({ status: 'idle' });
    return true;
  }

  async load(consented: boolean): Promise<boolean> {
    if (!consented) {
      this.publish({
        status: 'error',
        message: 'Confirm the local model download before loading it.',
      });
      return false;
    }
    if (this.loadPending || this.currentState.status === 'loading'
      || this.currentState.status === 'ready'
      || this.currentState.status === 'describing') {
      return false;
    }
    this.loadPending = true;
    try {
      if (!this.capabilityResult?.supported && !(await this.checkCapability())) {
        return false;
      }
      this.terminateWorker();
      const worker = this.options.workerFactory();
      this.worker = worker;
      worker.onmessage = (event) => {
        if (this.worker === worker) this.handleMessage(event.data);
      };
      worker.onerror = (event) => {
        if (this.worker === worker) this.fail(event.message || 'The local model worker failed.');
      };
      this.publish({ status: 'loading', progress: 0 });
      worker.postMessage({ type: 'load' });
      return true;
    } catch {
      this.fail('The local model worker could not start. Recording is still available.');
      return false;
    } finally {
      this.loadPending = false;
    }
  }

  describe(frame: SmolVlmFrame): boolean {
    validateSmolVlmFrame(frame);
    if (this.currentState.status !== 'ready' || !this.worker || this.activeRequest) {
      return false;
    }
    const request: ActiveRequest = {
      id: this.options.createId(),
      capturedAt: frame.capturedAt,
      startedAt: this.options.now(),
    };
    this.activeRequest = request;
    this.publish({ status: 'describing', startedAt: request.startedAt });
    this.timeout = this.options.setTimer(() => {
      if (this.activeRequest?.id !== request.id) return;
      this.fail('Local description timed out and the model was unloaded.');
    }, this.options.timeoutMs);
    try {
      this.worker.postMessage(
        {
          type: 'describe',
          requestId: request.id,
          pixels: frame.pixels.buffer,
          width: frame.width,
          height: frame.height,
        },
        [frame.pixels.buffer],
      );
      return true;
    } catch {
      this.fail('The frame could not be sent to the local model.');
      return false;
    }
  }

  unload(message?: string): void {
    this.generation += 1;
    this.terminateWorker();
    if (this.capabilityResult?.supported) {
      this.publish({ status: 'idle', message });
    } else if (this.capabilityResult) {
      this.publish({
        status: 'unsupported',
        message: this.capabilityResult.reason ?? 'Local descriptions are unsupported.',
      });
    } else {
      this.publish({ status: 'checking' });
    }
  }

  dispose(): void {
    this.generation += 1;
    this.terminateWorker();
  }

  private handleMessage(value: unknown): void {
    if (!isWorkerResponse(value)) {
      this.fail('The local model worker returned an unreadable message.');
      return;
    }
    if (value.type === 'progress') {
      if (this.currentState.status !== 'loading') return;
      this.publish({
        status: 'loading',
        progress: Math.min(100, Math.max(0, value.progress)),
        downloadedBytes: value.downloadedBytes,
        totalBytes: value.totalBytes,
        file: value.file,
      });
      return;
    }
    if (value.type === 'ready') {
      if (this.currentState.status === 'loading') {
        this.publish({ status: 'ready', result: null });
      }
      return;
    }
    if (value.type === 'error') {
      if (value.requestId && value.requestId !== this.activeRequest?.id) return;
      this.fail(value.message);
      return;
    }

    const active = this.activeRequest;
    if (!active || value.requestId !== active.id) return;
    try {
      const description = validateSmolVlmDescription(value.description);
      const analyzedAt = this.options.now();
      this.clearRequest();
      this.publish({
        status: 'ready',
        result: {
          description,
          source: 'local-model',
          model: SMOLVLM_MODEL,
          revision: SMOLVLM_REVISION,
          capturedAt: active.capturedAt,
          analyzedAt,
          latencyMs: Math.max(0, analyzedAt - active.startedAt),
        },
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'The local description was discarded.');
    }
  }

  private fail(message: string): void {
    this.terminateWorker();
    this.publish({ status: 'error', message });
  }

  private clearRequest(): void {
    if (this.timeout !== null) {
      this.options.clearTimer(this.timeout);
      this.timeout = null;
    }
    this.activeRequest = null;
  }

  private terminateWorker(): void {
    this.clearRequest();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  private publish(state: SmolVlmState): void {
    this.currentState = state;
    this.options.onState?.(state);
  }
}
