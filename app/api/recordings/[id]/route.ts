import { getD1 } from '@/db';
import { requireUser } from '@/server/auth/runtime';
import { errorResponse, json, readJsonObject } from '@/server/http';
import { D1RecordingStore } from '@/server/recordings/d1-store';
import { createRecordingService } from '@/server/recordings/service';
import { requireMutationOrigin } from '@/server/security';
import { env } from 'cloudflare:workers';

type Context = { params: Promise<{ id: string }> };

function validId(id: string) {
  return /^[A-Za-z0-9-]{1,64}$/.test(id);
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!validId(id)) return json({ error: 'Recording id is invalid.' }, 400);
    const service = createRecordingService({ store: new D1RecordingStore(getD1()) });
    return json({ recording: await service.get(user.id, id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireMutationOrigin(request, env.APP_ORIGIN);
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!validId(id)) return json({ error: 'Recording id is invalid.' }, 400);
    const service = createRecordingService({ store: new D1RecordingStore(getD1()) });
    return json({ recording: await service.update(user.id, id, await readJsonObject(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireMutationOrigin(request, env.APP_ORIGIN);
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!validId(id)) return json({ error: 'Recording id is invalid.' }, 400);
    const service = createRecordingService({ store: new D1RecordingStore(getD1()) });
    await service.delete(user.id, id);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
