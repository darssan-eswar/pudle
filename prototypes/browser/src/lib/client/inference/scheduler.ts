import {
  LOCAL_INFERENCE_MIN_INTERVAL_MS,
  type LocalInferenceResult,
  type LocalInferenceState,
  type LocalModelAdapter,
} from './contracts';

interface SchedulerOptions {
  minimumIntervalMs?: number;
  now?: () => number;
  onResult?: (result: LocalInferenceResult) => void;
  onState?: (state: LocalInferenceState) => void;
}

export class LocalInferenceScheduler<Input> {
  private generation = 0;
  private inference?: Promise<boolean>;
  private loadController?: AbortController;
  private loadTask?: Promise<boolean>;
  private inferenceController?: AbortController;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private stateValue: LocalInferenceState;

  private readonly minimumIntervalMs: number;
  private readonly now: () => number;
  private readonly onResult?: (result: LocalInferenceResult) => void;
  private readonly onState?: (state: LocalInferenceState) => void;

  constructor(
    private readonly adapter: LocalModelAdapter<Input>,
    options: SchedulerOptions = {},
  ) {
    const minimumIntervalMs =
      options.minimumIntervalMs ?? LOCAL_INFERENCE_MIN_INTERVAL_MS;
    if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 1) {
      throw new Error('Local inference cadence must be at least one millisecond.');
    }
    this.minimumIntervalMs = minimumIntervalMs;
    this.now = options.now ?? Date.now;
    this.onResult = options.onResult;
    this.onState = options.onState;
    this.stateValue = {
      status: 'capability',
      capability: adapter.capability(),
    };
  }

  get state(): LocalInferenceState {
    return this.stateValue;
  }

  private publish(state: LocalInferenceState): void {
    this.stateValue = state;
    this.onState?.(state);
  }

  async start(): Promise<boolean> {
    if (this.stateValue.status === 'ready') return true;
    if (this.loadTask) {
      const observedGeneration = this.generation;
      const loaded = await this.loadTask;
      if (loaded || observedGeneration !== this.generation) return loaded;
      return this.start();
    }
    if (this.inference) {
      const observedGeneration = this.generation;
      await this.inference;
      if (observedGeneration !== this.generation) return false;
    }

    const capability = this.adapter.capability();
    if (!capability.supported) {
      this.publish({
        status: 'error',
        capability,
        source: this.adapter.source,
        model: this.adapter.model,
        message: capability.reason ?? 'Local inference is unavailable in this browser.',
      });
      return false;
    }

    const requestGeneration = ++this.generation;
    const controller = new AbortController();
    this.loadController = controller;
    this.publish({
      status: 'loading',
      capability,
      source: this.adapter.source,
      model: this.adapter.model,
    });
    const task = (async () => {
      try {
        await this.adapter.load(controller.signal);
        if (controller.signal.aborted || requestGeneration !== this.generation) {
          return false;
        }
        this.publish({
          status: 'ready',
          capability,
          source: this.adapter.source,
          model: this.adapter.model,
          loadedAt: this.now(),
        });
        return true;
      } catch (error) {
        if (controller.signal.aborted || requestGeneration !== this.generation) {
          return false;
        }
        this.publish({
          status: 'error',
          capability,
          source: this.adapter.source,
          model: this.adapter.model,
          message:
            error instanceof Error
              ? error.message
              : 'The local model could not be loaded.',
        });
        return false;
      } finally {
        if (this.loadController === controller) this.loadController = undefined;
        this.loadTask = undefined;
      }
    })();
    this.loadTask = task;
    return task;
  }

  async run(input: Input, capturedAt = this.now()): Promise<boolean> {
    if (!Number.isFinite(capturedAt) || capturedAt < 0) {
      throw new Error('Local inference capture time must be a positive timestamp.');
    }
    const startedAt = this.now();
    if (
      this.stateValue.status !== 'ready'
      || this.inference
      || startedAt - this.lastStartedAt < this.minimumIntervalMs
    ) {
      return false;
    }

    this.lastStartedAt = startedAt;
    const requestGeneration = this.generation;
    const controller = new AbortController();
    this.inferenceController = controller;
    const readyState = this.stateValue;
    const task = (async () => {
      try {
        const observations = await this.adapter.infer(input, controller.signal);
        if (controller.signal.aborted || requestGeneration !== this.generation) {
          return false;
        }
        const analyzedAt = this.now();
        const result: LocalInferenceResult = {
          observations,
          source: this.adapter.source,
          model: this.adapter.model,
          capturedAt,
          analyzedAt,
          latencyMs: Math.max(0, analyzedAt - startedAt),
        };
        this.publish({ ...readyState, result });
        this.onResult?.(result);
        return true;
      } catch (error) {
        if (controller.signal.aborted || requestGeneration !== this.generation) {
          return false;
        }
        this.publish({
          status: 'error',
          capability: readyState.capability,
          source: this.adapter.source,
          model: this.adapter.model,
          message:
            error instanceof Error
              ? error.message
              : 'Local inference failed.',
        });
        return false;
      } finally {
        if (this.inferenceController === controller) {
          this.inferenceController = undefined;
        }
        this.inference = undefined;
      }
    })();
    this.inference = task;
    return task;
  }

  stop(): void {
    this.generation += 1;
    this.loadController?.abort();
    this.loadController = undefined;
    this.inferenceController?.abort();
    this.inferenceController = undefined;
    this.adapter.dispose();
    this.lastStartedAt = Number.NEGATIVE_INFINITY;
    this.publish({
      status: 'capability',
      capability: this.adapter.capability(),
    });
  }

  dispose(): void {
    this.stop();
  }
}
