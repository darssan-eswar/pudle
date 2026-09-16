import { env } from 'cloudflare:workers';
import { authenticatedContext, requireIdentifier, requireMutation } from '@/server/api';
import { requireMembership } from '@/server/auth/authorization';
import { D1GroupsStore } from '@/server/groups/d1-store';
import { createGroupsService } from '@/server/groups/service';
import { errorResponse, json, readJsonObject } from '@/server/http';

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    const groupId = requireIdentifier((await context.params).groupId, 'group ID');
    const { d1, store, user } = await authenticatedContext(request, 'groups:invite', 20);
    await requireMembership(store, user.id, groupId);
    const body = await readJsonObject(request, 1_024);
    return json(await createGroupsService(new D1GroupsStore(d1)).createInvite(user.id, groupId, body), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
