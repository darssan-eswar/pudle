import { ensureDatabase, getD1 } from '@/db';

const ALLOWED_TYPES = new Set([
  'road-hazard',
  'reckless-driver',
  'crash',
  'flooding',
  'object-on-road',
  'heavy-traffic',
  'parking-available',
  'gas-price',
]);

type EventRow = {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  confidence: number;
  source: string;
  created_at: number;
  expires_at: number;
};

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: Request) {
  await ensureDatabase();
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lng'));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ error: 'Valid lat and lng query parameters are required.' }, { status: 400 });
  }

  const now = Date.now();
  const d1 = getD1();
  await d1.prepare('DELETE FROM road_events WHERE expires_at <= ?').bind(now).run();

  const latitudeWindow = 2 / 69;
  const longitudeWindow = 2 / Math.max(1, 69 * Math.cos((latitude * Math.PI) / 180));
  const result = await d1.prepare(`SELECT id, type, latitude, longitude, confidence, source, created_at, expires_at
      FROM road_events
      WHERE expires_at > ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
      ORDER BY created_at DESC LIMIT 100`)
    .bind(now, latitude - latitudeWindow, latitude + latitudeWindow, longitude - longitudeWindow, longitude + longitudeWindow)
    .all<EventRow>();

  const events = result.results
    .map((event) => ({
      id: event.id,
      type: event.type,
      confidence: event.confidence,
      source: event.source,
      createdAt: event.created_at,
      expiresAt: event.expires_at,
      distanceMiles: distanceMiles(latitude, longitude, event.latitude, event.longitude),
    }))
    .filter((event) => event.distanceMiles <= 2)
    .slice(0, 30);

  return Response.json({ events, radiusMiles: 2 });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json() as Record<string, unknown>;
  const type = typeof body.type === 'string' ? body.type : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const confidence = Math.min(1, Math.max(0, Number(body.confidence) || 1));
  const source = body.source === 'edge-ai' ? 'edge-ai' : 'manual';

  if (!ALLOWED_TYPES.has(type) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ error: 'Invalid road-event metadata.' }, { status: 400 });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return Response.json({ error: 'Invalid coordinates.' }, { status: 400 });
  }

  const now = Date.now();
  const event = {
    id: crypto.randomUUID(),
    type,
    latitude,
    longitude,
    confidence,
    source,
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
  };

  await getD1().prepare(`INSERT INTO road_events
    (id, type, latitude, longitude, confidence, source, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(event.id, event.type, event.latitude, event.longitude, event.confidence, event.source, event.createdAt, event.expiresAt)
    .run();

  return Response.json({ event: { ...event, latitude: undefined, longitude: undefined } }, { status: 201 });
}
