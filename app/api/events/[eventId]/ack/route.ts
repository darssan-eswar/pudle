import { env } from 'cloudflare:workers';
import { authenticatedContext, requireIdempotencyKey, requireIdentifier, requireMutation } from '@/server/api';
import { D1EventStore } from '@/server/events/d1-store';
import { createEventService } from '@/server/events/service';
import { errorResponse, json } from '@/server/http';

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    requireIdempotencyKey(request);
    const eventId = requireIdentifier((await context.params).eventId, 'event ID');
    const { d1, user } = await authenticatedContext(request, 'events:ack', 60);
    return json(await createEventService(new D1EventStore(d1)).acknowledge(eventId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
