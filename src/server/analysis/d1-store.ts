import type {
  AnalysisJob,
  AnalysisResult,
  AnalysisStore,
  IdempotentResponse,
} from './contracts';
import { ANALYSIS_LEASE_MS } from './contracts';

export class D1AnalysisStore implements AnalysisStore {
  constructor(private readonly d1: D1Database) {}

  async cleanupExpired(now: number) {
    await this.d1.batch([
      this.d1.prepare(
        `DELETE FROM idempotency_records
         WHERE scope = 'analysis' AND response_status = 102
           AND (
             created_at <= ?
             OR resource_id IN (
               SELECT id FROM analysis_jobs
               WHERE status = 'running' AND lease_expires_at <= ?
             )
           )`,
      ).bind(now - ANALYSIS_LEASE_MS, now),
      this.d1.prepare(
        `UPDATE analysis_jobs
         SET status = 'failed', error_code = 'processing_lease_expired',
             completed_at = ?, updated_at = ?
         WHERE status = 'running' AND lease_expires_at <= ?`,
      ).bind(now, now, now),
      this.d1.prepare('DELETE FROM idempotency_records WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM analysis_results WHERE expires_at <= ?').bind(now),
      this.d1.prepare('DELETE FROM analysis_jobs WHERE expires_at <= ?').bind(now),
    ]);
  }

  async getIdempotent(userId: string, keyHash: string, now: number) {
    return this.d1.prepare(
      `SELECT response_status AS status, response_body AS body
       FROM idempotency_records
       WHERE scope = 'analysis' AND key_hash = ? AND user_id = ?
         AND expires_at > ? AND response_status != 102`,
    ).bind(keyHash, userId, now).first<IdempotentResponse>();
  }

  async reserveIdempotency(
    userId: string,
    keyHash: string,
    jobId: string,
    now: number,
    expiresAt: number,
  ) {
    const result = await this.d1.prepare(
      `INSERT OR IGNORE INTO idempotency_records
       (scope, key_hash, user_id, resource_id, response_status, response_body, created_at, expires_at)
       VALUES ('analysis', ?, ?, ?, 102, '', ?, ?)`,
    ).bind(keyHash, userId, jobId, now, expiresAt).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async startJob(job: AnalysisJob, minimumCreatedAt: number) {
    if (job.recordingId) {
      const recording = await this.d1.prepare(
        'SELECT 1 AS owned FROM recordings WHERE id = ? AND user_id = ? AND expires_at > ?',
      ).bind(job.recordingId, job.userId, job.createdAt).first<{ owned: number }>();
      if (!recording) return 'recording' as const;
    }
    const result = await this.d1.prepare(
      `INSERT INTO analysis_jobs
       (id, user_id, recording_id, status, frame_count, provider, error_code, started_at,
        lease_expires_at, completed_at, expires_at, created_at, updated_at)
       SELECT ?, ?, ?, 'running', 1, ?, NULL, ?, ?, NULL, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM analysis_jobs
         WHERE user_id = ? AND status = 'running' AND lease_expires_at > ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM analysis_jobs WHERE user_id = ? AND created_at > ? AND expires_at > ?
       )`,
    ).bind(
      job.id, job.userId, job.recordingId, job.provider, job.startedAt, job.leaseExpiresAt,
      job.expiresAt, job.createdAt, job.updatedAt, job.userId, job.createdAt, job.userId,
      minimumCreatedAt, job.createdAt,
    ).run();
    if ((result.meta.changes ?? 0) === 1) return 'started' as const;
    const running = await this.d1.prepare(
      `SELECT 1 AS active FROM analysis_jobs
       WHERE user_id = ? AND status = 'running' AND lease_expires_at > ? LIMIT 1`,
    ).bind(job.userId, job.createdAt).first<{ active: number }>();
    return running ? 'concurrency' as const : 'cadence' as const;
  }

  async complete(
    job: AnalysisJob,
    result: AnalysisResult,
    keyHash: string,
    responseStatus: number,
    responseBody: string,
  ) {
    const responses = await this.d1.batch([
      this.d1.prepare(
        `INSERT INTO analysis_results
         (id, job_id, category, summary, observations_json, confidence, uncertainty, source, model,
          observed_at, captured_at, analyzed_at, expires_at, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM analysis_jobs
         WHERE id = ? AND user_id = ? AND status = 'running' AND lease_expires_at > ?`,
      ).bind(
        crypto.randomUUID(), job.id, result.observations[0] ?? 'clear-road', result.summary,
        JSON.stringify(result.observations), result.confidence, result.uncertainty, result.source,
        result.model, result.capturedAt, result.capturedAt, result.analyzedAt, job.expiresAt,
        result.analyzedAt, job.id, job.userId, result.analyzedAt,
      ),
      this.d1.prepare(
        `UPDATE analysis_jobs SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'running' AND lease_expires_at > ?`,
      ).bind(job.completedAt, job.updatedAt, job.id, job.userId, result.analyzedAt),
      this.d1.prepare(
        `UPDATE idempotency_records SET response_status = ?, response_body = ?
         WHERE scope = 'analysis' AND key_hash = ? AND user_id = ?
           AND resource_id = ? AND response_status = 102`,
      ).bind(responseStatus, responseBody, keyHash, job.userId, job.id),
    ]);
    return (responses[0].meta.changes ?? 0) === 1;
  }

  async fail(
    job: AnalysisJob,
    keyHash: string,
    errorCode: string,
    responseStatus: number,
    responseBody: string,
  ) {
    await this.d1.batch([
      this.d1.prepare(
        `UPDATE analysis_jobs
         SET status = 'failed', error_code = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'running'`,
      ).bind(errorCode, job.completedAt, job.updatedAt, job.id, job.userId),
      this.d1.prepare(
        `UPDATE idempotency_records SET response_status = ?, response_body = ?
         WHERE scope = 'analysis' AND key_hash = ? AND user_id = ?
           AND resource_id = ? AND response_status = 102`,
      ).bind(responseStatus, responseBody, keyHash, job.userId, job.id),
    ]);
  }

  async abandonReservation(userId: string, keyHash: string, jobId: string) {
    await this.d1.prepare(
      `DELETE FROM idempotency_records
       WHERE scope = 'analysis' AND key_hash = ? AND user_id = ?
         AND resource_id = ? AND response_status = 102`,
    ).bind(keyHash, userId, jobId).run();
  }
}
