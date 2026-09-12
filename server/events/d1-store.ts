import type { EventRecord, EventStore } from './service';

type EventRow = {
  id: string;
  user_id: string;
  type: string;
  latitude: number;
  longitude: number;
  confidence: number;
  source: string;
  direction: string | null;
  created_at: number;
  expires_at: number;
  resolved_at: number | null;
};

function fromRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    latitude: row.latitude,
    longitude: row.longitude,
    confidence: row.confidence,
    source: row.source,
    direction: row.direction,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export class D1EventStore implements EventStore {
  constructor(private readonly d1: D1Database) {}

  async findIdempotent(userId: string, scope: string, keyHash: string, now: number) {
    const row = await this.d1.prepare(
      `SELECT response_status AS status, response_body AS body
       FROM idempotency_records WHERE user_id = ? AND scope = ? AND key_hash = ? AND expires_at > ?`,
    ).bind(userId, scope, keyHash, now).first<{ status: number; body: string }>();
    return row ?? null;
  }

  async saveEvent(event: EventRecord, keyHash: string, responseBody: string, now: number, expiresAt: number) {
    await this.d1.batch([
      this.d1.prepare(
        `INSERT INTO road_events
         (id, user_id, type, latitude, longitude, confidence, source, direction, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(event.id, event.userId, event.type, event.latitude, event.longitude, event.confidence, event.source, event.direction, event.createdAt, event.expiresAt),
      this.d1.prepare(
        `INSERT INTO idempotency_records
         (scope, key_hash, user_id, resource_id, response_status, response_body, created_at, expires_at)
         VALUES ('event:create', ?, ?, ?, 201, ?, ?, ?)`,
      ).bind(keyHash, event.userId, event.id, responseBody, now, expiresAt),
    ]);
  }

  async nearby(latitude: number, longitude: number, since: number, now: number) {
    const latitudeWindow = 2 / 69;
    const longitudeWindow = 2 / Math.max(1, 69 * Math.cos((latitude * Math.PI) / 180));
    const select = `SELECT id, user_id, type, latitude, longitude, confidence, source, direction, created_at, expires_at, resolved_at
       FROM road_events
       WHERE created_at > ? AND expires_at > ? AND resolved_at IS NULL
         AND latitude BETWEEN ? AND ?`;
    const lowerLongitude = longitude - longitudeWindow;
    const upperLongitude = longitude + longitudeWindow;
    let statement;
    if (latitude + latitudeWindow >= 90 || latitude - latitudeWindow <= -90) {
      statement = this.d1.prepare(`${select} ORDER BY created_at DESC LIMIT 500`)
        .bind(since, now, latitude - latitudeWindow, latitude + latitudeWindow);
    } else if (lowerLongitude < -180) {
      statement = this.d1.prepare(`${select} AND (longitude >= ? OR longitude <= ?) ORDER BY created_at DESC LIMIT 100`)
        .bind(since, now, latitude - latitudeWindow, latitude + latitudeWindow, lowerLongitude + 360, upperLongitude);
    } else if (upperLongitude > 180) {
      statement = this.d1.prepare(`${select} AND (longitude >= ? OR longitude <= ?) ORDER BY created_at DESC LIMIT 100`)
        .bind(since, now, latitude - latitudeWindow, latitude + latitudeWindow, lowerLongitude, upperLongitude - 360);
    } else {
      statement = this.d1.prepare(`${select} AND longitude BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 100`)
        .bind(since, now, latitude - latitudeWindow, latitude + latitudeWindow, lowerLongitude, upperLongitude);
    }
    const result = await statement.all<EventRow>();
    return result.results.map(fromRow);
  }

  async acknowledge(eventId: string, userId: string, now: number) {
    const event = await this.d1.prepare(
      'SELECT expires_at FROM road_events WHERE id = ? AND expires_at > ? AND resolved_at IS NULL',
    ).bind(eventId, now).first<{ expires_at: number }>();
    if (!event) return 'missing' as const;
    const result = await this.d1.prepare(
      `INSERT INTO event_acknowledgements (event_id, user_id, status, created_at, updated_at, expires_at)
       VALUES (?, ?, 'acknowledged', ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).bind(eventId, userId, now, now, event.expires_at).run();
    return result.meta.changes === 1 ? 'created' as const : 'existing' as const;
  }

  async resolve(eventId: string, userId: string, now: number) {
    const event = await this.d1.prepare(
      'SELECT user_id, resolved_at FROM road_events WHERE id = ? AND expires_at > ?',
    ).bind(eventId, now).first<{ user_id: string; resolved_at: number | null }>();
    if (!event) return 'missing' as const;
    if (event.user_id !== userId) return 'forbidden' as const;
    if (event.resolved_at !== null) return 'existing' as const;
    await this.d1.prepare('UPDATE road_events SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL')
      .bind(now, eventId).run();
    return 'resolved' as const;
  }
}
