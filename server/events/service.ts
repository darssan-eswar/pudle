import { HttpError } from '@/server/http';
import { createRuntimeId } from '@/server/runtime-id.mjs';
import { sha256 } from '@/server/security';

export const EVENT_TTL_MS = 30 * 60_000;
export const EVENT_RADIUS_MILES = 2;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const EVENT_TYPES = new Set([
  'road-hazard',
  'reckless-driver',
  'crash',
  'flooding',
  'object-on-road',
  'heavy-traffic',
  'parking-available',
  'gas-price',
]);
const DIRECTIONS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

export type EventRecord = {
  id: string;
  userId: string;
  type: string;
  latitude: number;
  longitude: number;
  confidence: number;
  source: string;
  direction: string | null;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
};

export type EventStore = {
  findIdempotent(userId: string, scope: string, keyHash: string, now: number): Promise<{ status: number; body: string } | null>;
  saveEvent(event: EventRecord, keyHash: string, responseBody: string, now: number, idempotencyExpiresAt: number): Promise<void>;
  nearby(latitude: number, longitude: number, since: number, now: number): Promise<EventRecord[]>;
  acknowledge(eventId: string, userId: string, now: number): Promise<'created' | 'existing' | 'missing'>;
  resolve(eventId: string, userId: string, now: number): Promise<'resolved' | 'existing' | 'forbidden' | 'missing'>;
};

export function roundCoordinate(value: number) {
  return Number(value.toFixed(3));
}

export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `Invalid ${name}.`);
  }
  return value;
}

export function validateCoordinates(latitude: unknown, longitude: unknown) {
  return {
    latitude: finiteCoordinate(latitude, -90, 90, 'latitude'),
    longitude: finiteCoordinate(longitude, -180, 180, 'longitude'),
  };
}

export function parseCreateEvent(body: Record<string, unknown>) {
  const { latitude, longitude } = validateCoordinates(body.latitude, body.longitude);
  if (typeof body.type !== 'string' || !EVENT_TYPES.has(body.type)) {
    throw new HttpError(400, 'Invalid event type.');
  }
  const confidence = body.confidence === undefined ? 1 : body.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new HttpError(400, 'Invalid confidence.');
  }
  const direction = body.direction === undefined || body.direction === null ? null : body.direction;
  if (direction !== null && (typeof direction !== 'string' || !DIRECTIONS.has(direction))) {
    throw new HttpError(400, 'Invalid direction.');
  }
  const source = body.source === undefined ? 'manual' : body.source;
  if (source !== 'manual' && source !== 'edge-ai') {
    throw new HttpError(400, 'Invalid event source.');
  }
  return {
    type: body.type,
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    confidence,
    source,
    direction,
  };
}

function isSafeStoredEvent(event: EventRecord) {
  return EVENT_TYPES.has(event.type)
    && Number.isFinite(event.confidence)
    && event.confidence >= 0
    && event.confidence <= 1
    && (event.direction === null || DIRECTIONS.has(event.direction))
    && (event.source === 'manual' || event.source === 'edge-ai');
}

function coarseDistanceBand(distance: number) {
  if (distance <= 0.5) return 'within-half-mile';
  if (distance <= 1) return 'within-one-mile';
  return 'within-two-miles';
}

function publicEvent(event: EventRecord, distance?: number) {
  return {
    id: event.id,
    type: event.type,
    confidence: event.confidence,
    source: event.source,
    ...(event.direction ? { direction: event.direction } : {}),
    createdAt: event.createdAt,
    expiresAt: event.expiresAt,
    ...(distance === undefined ? {} : { distanceBand: coarseDistanceBand(distance) }),
  };
}

export function createEventService(store: EventStore, options?: { now?: () => number; createId?: () => string }) {
  const now = options?.now ?? Date.now;
  const createId = options?.createId ?? createRuntimeId;

  return {
    async create(userId: string, body: Record<string, unknown>, idempotencyKey: string) {
      const keyHash = await sha256(idempotencyKey);
      const timestamp = now();
      const prior = await store.findIdempotent(userId, 'event:create', keyHash, timestamp);
      if (prior) return { status: prior.status, body: JSON.parse(prior.body) as unknown };
      const input = parseCreateEvent(body);
      const event: EventRecord = {
        id: createId(),
        userId,
        ...input,
        createdAt: timestamp,
        expiresAt: timestamp + EVENT_TTL_MS,
        resolvedAt: null,
      };
      const response = { event: publicEvent(event) };
      try {
        await store.saveEvent(
          event,
          keyHash,
          JSON.stringify(response),
          timestamp,
          timestamp + IDEMPOTENCY_TTL_MS,
        );
      } catch (error) {
        const winner = await store.findIdempotent(userId, 'event:create', keyHash, timestamp);
        if (!winner) throw error;
        return { status: winner.status, body: JSON.parse(winner.body) as unknown };
      }
      return { status: 201, body: response };
    },

    async nearby(latitudeValue: unknown, longitudeValue: unknown) {
      const coordinates = validateCoordinates(latitudeValue, longitudeValue);
      const coarseCoordinates = {
        latitude: Number(coordinates.latitude.toFixed(2)),
        longitude: Number(coordinates.longitude.toFixed(2)),
      };
      const timestamp = now();
      const candidates = await store.nearby(
        coarseCoordinates.latitude,
        coarseCoordinates.longitude,
        timestamp - EVENT_TTL_MS,
        timestamp,
      );
      return candidates
        .map((event) => ({
          event,
          distance: distanceMiles(
            coarseCoordinates.latitude,
            coarseCoordinates.longitude,
            Number(event.latitude.toFixed(2)),
            Number(event.longitude.toFixed(2)),
          ),
        }))
        .filter(({ event, distance }) => isSafeStoredEvent(event)
          && event.resolvedAt === null
          && event.createdAt > timestamp - EVENT_TTL_MS
          && event.createdAt <= timestamp
          && event.expiresAt > timestamp
          && distance <= EVENT_RADIUS_MILES)
        .sort((a, b) => a.distance - b.distance || b.event.createdAt - a.event.createdAt)
        .slice(0, 30)
        .map(({ event, distance }) => publicEvent(event, distance));
    },

    async acknowledge(eventId: string, userId: string) {
      const result = await store.acknowledge(eventId, userId, now());
      if (result === 'missing') throw new HttpError(404, 'Event not found.');
      return { acknowledged: true };
    },

    async resolve(eventId: string, userId: string) {
      const result = await store.resolve(eventId, userId, now());
      if (result === 'missing') throw new HttpError(404, 'Event not found.');
      if (result === 'forbidden') throw new HttpError(403, 'Only the event owner may resolve it.');
      return { resolved: true };
    },
  };
}
