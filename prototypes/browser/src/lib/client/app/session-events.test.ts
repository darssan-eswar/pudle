import { describe, expect, it, vi } from 'vitest';
import { readResponse } from './api';
import {
  notifySessionExpired,
  PUDLE_SESSION_EXPIRED_EVENT,
} from './session-events';

describe('session expiry events', () => {
  it('notifies the authenticated app when an API returns 401', async () => {
    const listener = vi.fn();
    window.addEventListener(PUDLE_SESSION_EXPIRED_EVENT, listener);

    await expect(
      readResponse(new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })),
    ).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(PUDLE_SESSION_EXPIRED_EVENT, listener);
  });

  it('does not notify for non-authentication failures', () => {
    const listener = vi.fn();
    window.addEventListener(PUDLE_SESSION_EXPIRED_EVENT, listener);

    notifySessionExpired(429);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(PUDLE_SESSION_EXPIRED_EVENT, listener);
  });
});
