import type { RecordingStore, StoredRecording } from './contracts';

type RecordingRow = {
  id: string;
  user_id: string;
  client_recording_id: string;
  duration_ms: number;
  mime_type: StoredRecording['mimeType'];
  byte_length: number;
  captured_at: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

const SELECT_FIELDS = `id, user_id, client_recording_id, duration_ms, mime_type, byte_length,
  captured_at, created_at, updated_at, expires_at`;

function fromRow(row: RecordingRow): StoredRecording {
  return {
    id: row.id,
    userId: row.user_id,
    clientRecordingId: row.client_recording_id,
    durationMs: row.duration_ms,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export class D1RecordingStore implements RecordingStore {
  constructor(private readonly d1: D1Database) {}

  async cleanupExpired(now: number) {
    await this.d1.prepare('DELETE FROM recordings WHERE expires_at <= ?').bind(now).run();
  }

  async list(userId: string, limit: number, now: number) {
    const rows = await this.d1.prepare(
      `SELECT ${SELECT_FIELDS} FROM recordings
       WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(userId, now, limit).all<RecordingRow>();
    return rows.results.map(fromRow);
  }

  async find(userId: string, id: string, now: number) {
    const row = await this.d1.prepare(
      `SELECT ${SELECT_FIELDS} FROM recordings WHERE id = ? AND user_id = ? AND expires_at > ?`,
    ).bind(id, userId, now).first<RecordingRow>();
    return row ? fromRow(row) : null;
  }

  async create(recording: StoredRecording) {
    await this.d1.prepare(
      `INSERT INTO recordings
       (id, user_id, client_recording_id, duration_ms, mime_type, byte_length, captured_at,
        expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      recording.id, recording.userId, recording.clientRecordingId, recording.durationMs,
      recording.mimeType, recording.byteLength, recording.capturedAt, recording.expiresAt,
      recording.createdAt, recording.updatedAt,
    ).run();
  }

  async update(
    userId: string,
    id: string,
    changes: Pick<StoredRecording, 'durationMs' | 'byteLength' | 'updatedAt'>,
    now: number,
  ) {
    await this.d1.prepare(
      `UPDATE recordings SET duration_ms = ?, byte_length = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND expires_at > ?`,
    ).bind(changes.durationMs, changes.byteLength, changes.updatedAt, id, userId, now).run();
    return this.find(userId, id, now);
  }

  async delete(userId: string, id: string) {
    const result = await this.d1.prepare(
      'DELETE FROM recordings WHERE id = ? AND user_id = ?',
    ).bind(id, userId).run();
    return (result.meta.changes ?? 0) > 0;
  }
}
