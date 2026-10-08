export const RECORDING_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const MAX_RECORDINGS_PER_USER = 100;

export type RecordingMetadata = {
  id: string;
  clientRecordingId: string;
  durationMs: number;
  mimeType: 'video/webm' | 'video/mp4';
  byteLength: number;
  capturedAt: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type StoredRecording = RecordingMetadata & { userId: string };

export interface RecordingStore {
  cleanupExpired(now: number): Promise<void>;
  list(userId: string, limit: number, now: number): Promise<StoredRecording[]>;
  find(userId: string, id: string, now: number): Promise<StoredRecording | null>;
  create(recording: StoredRecording): Promise<void>;
  update(
    userId: string,
    id: string,
    changes: Pick<StoredRecording, 'durationMs' | 'byteLength' | 'updatedAt'>,
    now: number,
  ): Promise<StoredRecording | null>;
  delete(userId: string, id: string): Promise<boolean>;
}
