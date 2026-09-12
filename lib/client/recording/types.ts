export type RecordingState =
  | 'idle'
  | 'acquiring'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'interrupted'
  | 'error';

export type RecordingErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'device-missing'
  | 'device-busy'
  | 'stream-interrupted'
  | 'invalid-state'
  | 'storage-quota'
  | 'storage-failed'
  | 'invalid-file'
  | 'file-too-large';

export class RecordingError extends Error {
  constructor(
    public readonly code: RecordingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecordingError';
  }
}

export interface RecordingMetadata {
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  size: number;
  mimeType: string;
}

export interface StoredRecording extends RecordingMetadata {
  blob: Blob;
}

export type RecordingMetadataChange =
  | { action: 'saved'; metadata: RecordingMetadata }
  | { action: 'deleted'; id: string };

export type RecordingEvent =
  | { type: 'state-change'; state: RecordingState }
  | { type: 'stream-ready'; stream: MediaStream }
  | { type: 'stream-interrupted' }
  | { type: 'recording-saved'; metadata: RecordingMetadata }
  | { type: 'recording-deleted'; id: string }
  | {
      type: 'metadata-sync-error';
      change: RecordingMetadataChange;
      error: unknown;
    }
  | { type: 'error'; error: RecordingError };

export interface RecordingCallbacks {
  onEvent?: (event: RecordingEvent) => void;
  /**
   * Optional integration seam for persisting non-sensitive recording metadata.
   * Implementations must never receive the Blob through this callback.
   */
  onMetadataChange?: (change: RecordingMetadataChange) => void | Promise<void>;
}
