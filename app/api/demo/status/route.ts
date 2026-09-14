import { env } from 'cloudflare:workers';
import { isDemoMode } from '@/server/demo';
import { json } from '@/server/http';

export function GET() {
  return json({ enabled: isDemoMode(env) });
}
