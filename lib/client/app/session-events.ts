export const PUDLE_SESSION_EXPIRED_EVENT = 'pudle:session-expired';

export function notifySessionExpired(status: number): void {
  if (status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUDLE_SESSION_EXPIRED_EVENT));
  }
}
