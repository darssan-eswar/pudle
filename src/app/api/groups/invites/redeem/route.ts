import { env } from 'cloudflare:workers';
import { authenticatedContext, requireMutation } from '@/server/api';
import { D1GroupsStore } from '@/server/groups/d1-store';
import { createGroupsService } from '@/server/groups/service';
import { errorResponse, json, readJsonObject } from '@/server/http';

export async function POST(request: Request) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    const { d1, user } = await authenticatedContext(request, 'groups:redeem', 20);
    const body = await readJsonObject(request, 1_024);
    return json(await createGroupsService(new D1GroupsStore(d1)).redeemInvite(user.id, user.email, body));
  } catch (error) {
    return errorResponse(error);
  }
}
