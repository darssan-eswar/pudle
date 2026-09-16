import { HttpError } from '@/server/http';
import {
  MAX_RECORDINGS_PER_USER,
  RECORDING_RETENTION_MS,
  type RecordingMetadata,
  type RecordingStore,
  type StoredRecording,
} from './contracts';

const ALLOWED_MIME_TYPES = new Set<RecordingMetadata['mimeType']>(['video/webm', 'video/mp4']);

function requiredInteger(value: unknown, name: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HttpError(400, `${name} is invalid.`);
  }
  return value as number;
}

function validateClientId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new HttpError(400, 'clientRecordingId is invalid.');
  }
  return value;
}

function validateMimeType(value: unknown): RecordingMetadata['mimeType'] {
  if (typeof value !== 'string' || !ALLOWED_MIME_TYPES.has(value as RecordingMetadata['mimeType'])) {
    throw new HttpError(400, 'mimeType is invalid.');
  }
  return value as RecordingMetadata['mimeType'];
}

function publicMetadata(recording: StoredRecording): RecordingMetadata {
  return {
    id: recording.id,
    clientRecordingId: recording.clientRecordingId,
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
    byteLength: recording.byteLength,
    capturedAt: recording.capturedAt,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    expiresAt: recording.expiresAt,
  };
}

export function createRecordingService(options: {
  store: RecordingStore;
  now?: () => number;
  createId?: () => string;
}) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());

  return {
    async list(userId: string, limitValue?: unknown) {
      const timestamp = now();
      await options.store.cleanupExpired(timestamp);
      const limit = limitValue === undefined
        ? 30
        : requiredInteger(limitValue, 'limit', 1, MAX_RECORDINGS_PER_USER);
      return (await options.store.list(userId, limit, timestamp)).map(publicMetadata);
    },

    async get(userId: string, id: string) {
      const recording = await options.store.find(userId, id, now());
      if (!recording) throw new HttpError(404, 'Recording metadata was not found.');
      return publicMetadata(recording);
    },

    async create(userId: string, input: Record<string, unknown>) {
      const allowed = new Set([
        'clientRecordingId',
        'durationMs',
        'mimeType',
        'byteLength',
        'capturedAt',
      ]);
      if (Object.keys(input).some((key) => !allowed.has(key))) {
        throw new HttpError(400, 'Recording metadata contains unsupported fields.');
      }
      const timestamp = now();
      const capturedAt = requiredInteger(
        input.capturedAt,
        'capturedAt',
        timestamp - RECORDING_RETENTION_MS,
        timestamp + 5 * 60_000,
      );
      const recording: StoredRecording = {
        id: createId(),
        userId,
        clientRecordingId: validateClientId(input.clientRecordingId),
        durationMs: requiredInteger(input.durationMs, 'durationMs', 0, 24 * 60 * 60 * 1_000),
        mimeType: validateMimeType(input.mimeType),
        byteLength: requiredInteger(input.byteLength, 'byteLength', 0, 2_000_000_000),
        capturedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: Math.min(capturedAt + RECORDING_RETENTION_MS, timestamp + RECORDING_RETENTION_MS),
      };
      await options.store.cleanupExpired(timestamp);
      try {
        await options.store.create(recording);
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE')) {
          throw new HttpError(409, 'clientRecordingId already exists.');
        }
        throw error;
      }
      return publicMetadata(recording);
    },

    async update(userId: string, id: string, input: Record<string, unknown>) {
      const allowed = new Set(['durationMs', 'byteLength']);
      const keys = Object.keys(input);
      if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
        throw new HttpError(400, 'Only durationMs and byteLength may be updated.');
      }
      const existing = await options.store.find(userId, id, now());
      if (!existing) throw new HttpError(404, 'Recording metadata was not found.');
      const updated = await options.store.update(userId, id, {
        durationMs: input.durationMs === undefined
          ? existing.durationMs
          : requiredInteger(input.durationMs, 'durationMs', 0, 24 * 60 * 60 * 1_000),
        byteLength: input.byteLength === undefined
          ? existing.byteLength
          : requiredInteger(input.byteLength, 'byteLength', 0, 2_000_000_000),
        updatedAt: now(),
      }, now());
      if (!updated) throw new HttpError(404, 'Recording metadata was not found.');
      return publicMetadata(updated);
    },

    async delete(userId: string, id: string) {
      if (!await options.store.delete(userId, id)) {
        throw new HttpError(404, 'Recording metadata was not found.');
      }
    },
  };
}
