import { env } from 'cloudflare:workers';
import { authenticatedContext, requireMutation } from '@/server/api';
import { D1GroupsStore } from '@/server/groups/d1-store';
import { createGroupsService } from '@/server/groups/service';
import { errorResponse, json, readJsonObject } from '@/server/http';

export async function GET(request: Request) {
  try {
    const { d1, user } = await authenticatedContext(request, 'groups:list', 60);
    const groups = await createGroupsService(new D1GroupsStore(d1)).listGroups(user.id);
    return json({ groups });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    const { d1, user } = await authenticatedContext(request, 'groups:create', 10);
    const body = await readJsonObject(request, 1_024);
    return json(await createGroupsService(new D1GroupsStore(d1)).createGroup(user.id, body), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
