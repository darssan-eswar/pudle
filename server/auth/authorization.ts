import type { AuthStore, PublicUser } from './contracts';
import { HttpError } from '../http';

type SessionReader = {
  currentUser(token: string | null): Promise<PublicUser | null>;
};

export async function requireAuthenticatedUser(auth: SessionReader, token: string | null) {
  const user = await auth.currentUser(token);
  if (!user) throw new HttpError(401, 'Authentication required.');
  return user;
}

export async function requireMembership(store: AuthStore, userId: string, groupId: string) {
  if (!await store.isGroupMember(userId, groupId)) {
    throw new HttpError(403, 'Group membership required.');
  }
}
