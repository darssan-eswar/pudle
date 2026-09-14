const DEFAULT_ORIGIN = 'https://pulzar-road-intelligence.ledarssan919276.chatgpt.site';

/** Canonical URLs use deployment configuration, never visitor-supplied headers. */
export function publicOrigin(configured?: string): URL {
  if (!configured) return new URL(DEFAULT_ORIGIN);
  try {
    const url = new URL(configured);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      return new URL(DEFAULT_ORIGIN);
    }
    return new URL(url.origin);
  } catch {
    return new URL(DEFAULT_ORIGIN);
  }
}
