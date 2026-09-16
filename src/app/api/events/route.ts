import { env } from 'cloudflare:workers';
import { authenticatedContext, requireIdempotencyKey, requireMutation } from '@/server/api';
import { D1EventStore } from '@/server/events/d1-store';
import { createEventService } from '@/server/events/service';
import { errorResponse, json, readJsonObject } from '@/server/http';

export async function GET(request: Request) {
  try {
    const { d1, user } = await authenticatedContext(request, 'events:nearby', 60);
    const url = new URL(request.url);
    const latitudeValue = url.searchParams.get('lat');
    const longitudeValue = url.searchParams.get('lng');
    const latitude = latitudeValue === null ? Number.NaN : Number(latitudeValue);
    const longitude = longitudeValue === null ? Number.NaN : Number(longitudeValue);
    const events = await createEventService(new D1EventStore(d1)).nearby(latitude, longitude, user.id);
    return json({ events, radiusMiles: 2 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    const key = requireIdempotencyKey(request);
    const { d1, user } = await authenticatedContext(request, 'events:create', 30);
    const body = await readJsonObject(request, 2_048);
    const result = await createEventService(new D1EventStore(d1)).create(user.id, body, key);
    return json(result.body, result.status);
  } catch (error) {
    return errorResponse(error);
  }
}
