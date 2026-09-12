import { readResponse } from './api';

/**
 * Single response boundary for every event request. The parent integration can
 * call notifySessionExpired(response.status) here when its session-events
 * module is present, without duplicating session lifecycle ownership.
 */
function readEventResponse<T>(response: Response): Promise<T> {
  return readResponse<T>(response);
}

export const EVENT_TYPES = [
  'road-hazard',
  'reckless-driver',
  'crash',
  'flooding',
  'object-on-road',
  'heavy-traffic',
  'parking-available',
  'gas-price',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type DistanceBand =
  | 'within-half-mile'
  | 'within-one-mile'
  | 'within-two-miles';

export interface NearbyEvent {
  id: string;
  type: EventType;
  confidence: number;
  source: 'manual' | 'edge-ai';
  direction?: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  createdAt: number;
  expiresAt: number;
  distanceBand: DistanceBand;
}

export interface EventCoordinates {
  latitude: number;
  longitude: number;
}

export interface CreateEventInput extends EventCoordinates {
  type: EventType;
  direction?: NearbyEvent['direction'];
}

export interface EventsApi {
  nearby(coordinates: EventCoordinates, signal: AbortSignal): Promise<NearbyEvent[]>;
  create(input: CreateEventInput, idempotencyKey: string, signal: AbortSignal): Promise<NearbyEvent>;
  acknowledge(eventId: string, idempotencyKey: string, signal: AbortSignal): Promise<void>;
  resolve(eventId: string, idempotencyKey: string, signal: AbortSignal): Promise<void>;
}

const eventTypes = new Set<string>(EVENT_TYPES);
const distanceBands = new Set<string>([
  'within-half-mile',
  'within-one-mile',
  'within-two-miles',
]);
const directions = new Set<string>(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

export function roundEventCoordinates(coordinates: EventCoordinates): EventCoordinates {
  return {
    latitude: Number(coordinates.latitude.toFixed(3)),
    longitude: Number(coordinates.longitude.toFixed(3)),
  };
}

export function createEventIdempotencyKey(scope: 'create' | 'ack' | 'resolve'): string {
  return `event-${scope}-${crypto.randomUUID()}`;
}

function parseEvent(value: unknown, nearby: boolean): NearbyEvent {
  if (!value || typeof value !== 'object') throw new Error('The nearby event response was unreadable.');
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string'
    || typeof item.type !== 'string'
    || !eventTypes.has(item.type)
    || typeof item.confidence !== 'number'
    || item.confidence < 0
    || item.confidence > 1
    || (item.source !== 'manual' && item.source !== 'edge-ai')
    || typeof item.createdAt !== 'number'
    || typeof item.expiresAt !== 'number'
    || (nearby && (typeof item.distanceBand !== 'string' || !distanceBands.has(item.distanceBand)))
    || (item.direction !== undefined
      && (typeof item.direction !== 'string' || !directions.has(item.direction)))
  ) {
    throw new Error('The nearby event response was unreadable.');
  }
  return item as unknown as NearbyEvent;
}

function mutationOptions(
  idempotencyKey: string,
  signal: AbortSignal,
  body: object = {},
): RequestInit {
  return {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Pudle-CSRF': '1',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  };
}

export function createEventsApi(fetcher: typeof fetch = fetch): EventsApi {
  return {
    async nearby(coordinates, signal) {
      const rounded = roundEventCoordinates(coordinates);
      const query = new URLSearchParams({
        lat: String(rounded.latitude),
        lng: String(rounded.longitude),
      });
      const body = await fetcher(`/api/events?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      }).then(readEventResponse<{ events?: unknown }>);
      if (!Array.isArray(body.events)) throw new Error('The nearby event response was unreadable.');
      return body.events.map((event) => parseEvent(event, true));
    },
    async create(input, idempotencyKey, signal) {
      const coordinates = roundEventCoordinates(input);
      const body = await fetcher('/api/events', mutationOptions(idempotencyKey, signal, {
        type: input.type,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        source: 'manual',
        ...(input.direction ? { direction: input.direction } : {}),
      })).then(readEventResponse<{ event?: unknown }>);
      return parseEvent(body.event, false);
    },
    async acknowledge(eventId, idempotencyKey, signal) {
      await fetcher(
        `/api/events/${encodeURIComponent(eventId)}/ack`,
        mutationOptions(idempotencyKey, signal),
      ).then(readEventResponse);
    },
    async resolve(eventId, idempotencyKey, signal) {
      await fetcher(
        `/api/events/${encodeURIComponent(eventId)}/resolve`,
        mutationOptions(idempotencyKey, signal),
      ).then(readEventResponse);
    },
  };
}

export class NearbyPollController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private running = false;
  private inFlight = false;
  readonly intervalMs: number;

  constructor(
    private readonly task: (signal: AbortSignal) => Promise<void>,
    intervalMs = 5_000,
  ) {
    this.intervalMs = Math.max(5_000, intervalMs);
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  retry() {
    if (!this.running || this.inFlight) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    void this.poll();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }

  private async poll() {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.task(controller.signal);
    } finally {
      this.inFlight = false;
      if (this.controller === controller) this.controller = undefined;
      if (this.running) {
        this.timer = setTimeout(() => void this.poll(), this.intervalMs);
      }
    }
  }
}

export const EVENT_LABELS: Record<EventType, string> = {
  'road-hazard': 'Road hazard',
  'reckless-driver': 'Vehicle moving unpredictably',
  crash: 'Crash',
  flooding: 'Flooding',
  'object-on-road': 'Object on road',
  'heavy-traffic': 'Heavy traffic',
  'parking-available': 'Parking available',
  'gas-price': 'Gas price posted',
};

export const DISTANCE_LABELS: Record<DistanceBand, string> = {
  'within-half-mile': 'Within ½ mile',
  'within-one-mile': 'Within 1 mile',
  'within-two-miles': 'Within 2 miles',
};
