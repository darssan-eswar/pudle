export const LOCAL_INFERENCE_MIN_INTERVAL_MS = 1_500;

export interface LocalModelCapability {
  supported: boolean;
  reason?: string;
}

export interface LocalObservation {
  label: string;
  confidence: number;
}

export interface LocalInferenceResult {
  observations: LocalObservation[];
  source: 'local-model';
  model: string;
  capturedAt: number;
  analyzedAt: number;
  latencyMs: number;
}

export type LocalInferenceState =
  | {
      status: 'capability';
      capability: LocalModelCapability;
    }
  | {
      status: 'loading';
      capability: LocalModelCapability;
      source: 'local-model';
      model: string;
    }
  | {
      status: 'ready';
      capability: LocalModelCapability;
      source: 'local-model';
      model: string;
      loadedAt: number;
      result?: LocalInferenceResult;
    }
  | {
      status: 'error';
      capability: LocalModelCapability;
      source: 'local-model';
      model: string;
      message: string;
    };

export interface LocalModelAdapter<Input> {
  readonly source: 'local-model';
  readonly model: string;
  capability(): LocalModelCapability;
  load(signal: AbortSignal): Promise<void>;
  infer(input: Input, signal: AbortSignal): Promise<LocalObservation[]>;
  dispose(): void;
}
