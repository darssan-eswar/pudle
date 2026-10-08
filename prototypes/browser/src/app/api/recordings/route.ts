import { getD1 } from '@/db';
import { D1AuthStore } from '@/server/auth/d1-store';
import { enforceRateLimit, requireUser } from '@/server/auth/runtime';
import { errorResponse, json, readJsonObject } from '@/server/http';
import { D1RecordingStore } from '@/server/recordings/d1-store';
import { createRecordingService } from '@/server/recordings/service';
import { requireMutationOrigin } from '@/server/security';
import { env } from 'cloudflare:workers';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = new URL(request.url).searchParams.get('limit');
    const service = createRecordingService({ store: new D1RecordingStore(getD1()) });
    return json({ recordings: await service.list(user.id, limit === null ? undefined : Number(limit)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request, env.APP_ORIGIN);
    const user = await requireUser(request);
    const d1 = getD1();
    await enforceRateLimit(request, new D1AuthStore(d1), 'recordings-create', 30, 60_000);
    const service = createRecordingService({ store: new D1RecordingStore(d1) });
    const recording = await service.create(user.id, await readJsonObject(request));
    return json({ recording }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
