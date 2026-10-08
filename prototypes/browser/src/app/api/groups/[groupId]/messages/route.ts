import { env } from 'cloudflare:workers';
import { authenticatedContext, requireIdempotencyKey, requireIdentifier, requireMutation } from '@/server/api';
import { requireMembership } from '@/server/auth/authorization';
import { D1GroupsStore } from '@/server/groups/d1-store';
import { createGroupsService } from '@/server/groups/service';
import { errorResponse, json, readJsonObject } from '@/server/http';

export async function GET(request: Request, context: { params: Promise<{ groupId: string }> }) {
  try {
    const groupId = requireIdentifier((await context.params).groupId, 'group ID');
    const { d1, store, user } = await authenticatedContext(request, 'messages:list', 120);
    await requireMembership(store, user.id, groupId);
    const url = new URL(request.url);
    const result = await createGroupsService(new D1GroupsStore(d1)).listMessages(
      user.id,
      groupId,
      url.searchParams.get('cursor'),
      url.searchParams.get('limit'),
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  try {
    requireMutation(request, env.APP_ORIGIN);
    const key = requireIdempotencyKey(request);
    const groupId = requireIdentifier((await context.params).groupId, 'group ID');
    const { d1, store, user } = await authenticatedContext(request, 'messages:send', 60);
    await requireMembership(store, user.id, groupId);
    const body = await readJsonObject(request, 2_048);
    const result = await createGroupsService(new D1GroupsStore(d1)).sendMessage(user.id, groupId, body, key);
    return json(result.body, result.status);
  } catch (error) {
    return errorResponse(error);
  }
}
