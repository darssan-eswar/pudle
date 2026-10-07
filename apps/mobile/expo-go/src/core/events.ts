// Validates rows from Supabase before anything can be spoken. Ported from EventDecoding.swift.
import { HAZARD_KINDS, SIDES, isValidLocation, type HazardEvent, type HazardKind, type HazardLocation, type HazardSide } from './types';

export const LIMITS = { maxClockSkewMs: 30_000, maxAgeMs: 60 * 60_000, maxLifetimeMs: 60 * 60_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Rejection =
  | 'malformed' | 'unsupportedSchema' | 'unknownKind' | 'unknownSource' | 'badTimestamp'
  | 'createdInFuture' | 'expired' | 'tooOld' | 'lifetimeTooLong' | 'invalidLocation' | 'wrongConvoy';

export type Result = { ok: true; event: HazardEvent } | { ok: false; reason: Rejection };

export function checkTimes(event: HazardEvent, now: number): Result {
  if (event.expiresAt <= event.createdAt) return { ok: false, reason: 'badTimestamp' };
  if (event.expiresAt - event.createdAt > LIMITS.maxLifetimeMs) return { ok: false, reason: 'lifetimeTooLong' };
  if (event.createdAt > now + LIMITS.maxClockSkewMs) return { ok: false, reason: 'createdInFuture' };
  if (event.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (now - event.observedAt > LIMITS.maxAgeMs) return { ok: false, reason: 'tooOld' };
  return { ok: true, event };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseHazardRow(raw: unknown, expectedConvoy: string | null, now: number): Result {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id)) return { ok: false, reason: 'malformed' };
  if (r.schema_version !== 1) return { ok: false, reason: 'unsupportedSchema' };
  if (typeof r.convoy_id !== 'string') return { ok: false, reason: 'malformed' };
  if (expectedConvoy && r.convoy_id !== expectedConvoy) return { ok: false, reason: 'wrongConvoy' };
  if (typeof r.kind !== 'string' || !(HAZARD_KINDS as readonly string[]).includes(r.kind)) return { ok: false, reason: 'unknownKind' };
  if (r.source !== 'convoy_member' && r.source !== 'driver_confirmed_camera') return { ok: false, reason: 'unknownSource' };
  const side = (r.side ?? 'unknown') as string;
  if (!(SIDES as readonly string[]).includes(side)) return { ok: false, reason: 'malformed' };
  const observed = Date.parse(String(r.observed_at)), created = Date.parse(String(r.created_at)), expires = Date.parse(String(r.expires_at));
  if (![observed, created, expires].every(Number.isFinite)) return { ok: false, reason: 'badTimestamp' };
  if (observed > created + LIMITS.maxClockSkewMs) return { ok: false, reason: 'badTimestamp' };

  let location: HazardLocation | null = null;
  const lat = num(r.latitude), lon = num(r.longitude), acc = num(r.accuracy_m), heading = num(r.heading_deg);
  if (r.latitude != null || r.longitude != null || r.accuracy_m != null) {
    if (lat == null || lon == null || acc == null) return { ok: false, reason: 'invalidLocation' };
    location = { latitude: lat, longitude: lon, accuracyMeters: acc, headingDegrees: heading };
    if (!isValidLocation(location)) return { ok: false, reason: 'invalidLocation' };
  } else if (r.heading_deg != null) {
    return { ok: false, reason: 'invalidLocation' };
  }
  if (r.source === 'driver_confirmed_camera' && !location) return { ok: false, reason: 'invalidLocation' };

  return checkTimes({
    id: r.id, kind: r.kind as HazardKind, source: r.source, side: side as HazardSide,
    blocksRoad: r.blocks_road === true, convoyId: r.convoy_id,
    reporterId: typeof r.reporter_id === 'string' ? r.reporter_id : undefined,
    observedAt: observed, createdAt: created, expiresAt: expires, location,
  }, now);
}
