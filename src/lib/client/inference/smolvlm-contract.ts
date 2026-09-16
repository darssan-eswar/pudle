export const SMOLVLM_MODEL = 'HuggingFaceTB/SmolVLM-256M-Instruct';
export const SMOLVLM_REVISION =
  '7e3e67edbbed1bf9888184d9df282b700a323964';
export const SMOLVLM_MAX_INPUT_DIMENSION = 512;
export const SMOLVLM_MAX_NEW_TOKENS = 64;
export const SMOLVLM_INFERENCE_TIMEOUT_MS = 45_000;

export const SMOLVLM_PROMPT =
  'Describe only directly visible road conditions and objects in one short sentence. '
  + 'Do not infer identity, intent, intoxication, ownership, fault, location, or license-plate text.';

export interface SmolVlmCapability {
  supported: boolean;
  reason?: string;
}

export interface SmolVlmFrame {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  capturedAt: number;
}

export interface SmolVlmResult {
  description: string;
  source: 'local-model';
  model: typeof SMOLVLM_MODEL;
  revision: typeof SMOLVLM_REVISION;
  capturedAt: number;
  analyzedAt: number;
  latencyMs: number;
}

export type SmolVlmState =
  | { status: 'checking' }
  | { status: 'unsupported'; message: string }
  | { status: 'idle'; message?: string }
  | {
      status: 'loading';
      progress: number;
      downloadedBytes?: number;
      totalBytes?: number;
      file?: string;
    }
  | { status: 'ready'; result: SmolVlmResult | null }
  | { status: 'describing'; startedAt: number }
  | { status: 'error'; message: string };

export type SmolVlmWorkerRequest =
  | { type: 'load' }
  | {
      type: 'describe';
      requestId: string;
      pixels: ArrayBuffer;
      width: number;
      height: number;
    };

export type SmolVlmWorkerResponse =
  | {
      type: 'progress';
      progress: number;
      downloadedBytes?: number;
      totalBytes?: number;
      file?: string;
    }
  | { type: 'ready' }
  | { type: 'result'; requestId: string; description: string }
  | { type: 'error'; requestId?: string; message: string };

export function validateSmolVlmFrame(
  frame: Pick<SmolVlmFrame, 'pixels' | 'width' | 'height' | 'capturedAt'>,
): void {
  if (
    !Number.isInteger(frame.width)
    || !Number.isInteger(frame.height)
    || frame.width < 1
    || frame.height < 1
    || frame.width > SMOLVLM_MAX_INPUT_DIMENSION
    || frame.height > SMOLVLM_MAX_INPUT_DIMENSION
  ) {
    throw new Error('Local model frames must be between 1 and 512 pixels per side.');
  }
  if (frame.pixels.byteLength !== frame.width * frame.height * 4) {
    throw new Error('Local model frame pixels do not match the declared dimensions.');
  }
  if (!Number.isFinite(frame.capturedAt) || frame.capturedAt <= 0) {
    throw new Error('Local model frames require a valid capture timestamp.');
  }
}

export function validateSmolVlmDescription(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('The local model returned an unreadable description.');
  }
  const description = value.replace(/\s+/g, ' ').trim();
  if (!description || description.length > 480) {
    throw new Error('The local model returned an invalid description length.');
  }
  const prohibited =
    /\b(?:license\s*plate|registration\s*(?:number|plate)|facial?\s+(?:recognition|identity)|intoxicated|drunk|owner|culpable|guilty|at\s+fault|suspect)\b/i;
  if (prohibited.test(description)) {
    throw new Error('The local model response included a prohibited inference and was discarded.');
  }
  return description;
}
