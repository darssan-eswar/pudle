import type { AppUser } from './api';

export type AuthState =
  | { status: 'loading'; user: null; error: null }
  | { status: 'anonymous'; user: null; error: string | null }
  | { status: 'submitting'; user: null; error: null }
  | { status: 'authenticated'; user: AppUser; error: null }
  | { status: 'signing-out'; user: AppUser; error: null };

export type AuthAction =
  | { type: 'session-resolved'; user: AppUser | null }
  | { type: 'submit' }
  | { type: 'authenticated'; user: AppUser }
  | { type: 'failed'; message: string }
  | { type: 'sign-out' }
  | { type: 'signed-out' };

export const initialAuthState: AuthState = {
  status: 'loading',
  user: null,
  error: null,
};

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'session-resolved':
      return action.user
        ? { status: 'authenticated', user: action.user, error: null }
        : { status: 'anonymous', user: null, error: null };
    case 'submit':
      return { status: 'submitting', user: null, error: null };
    case 'authenticated':
      return { status: 'authenticated', user: action.user, error: null };
    case 'failed':
      return state.user
        ? { status: 'authenticated', user: state.user, error: null }
        : { status: 'anonymous', user: null, error: action.message };
    case 'sign-out':
      return state.user
        ? { status: 'signing-out', user: state.user, error: null }
        : state;
    case 'signed-out':
      return { status: 'anonymous', user: null, error: null };
  }
}

export type RemoteState<T> =
  | { status: 'idle' | 'loading'; data: null; message?: string }
  | { status: 'ready'; data: T; message?: string }
  | { status: 'empty' | 'unavailable'; data: null; message: string };
