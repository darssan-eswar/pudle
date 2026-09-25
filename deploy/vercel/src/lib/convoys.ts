import type { SupabaseClient } from '@supabase/supabase-js';
import { isFreshReport, parseReport, type ObstacleKind, type ObstacleReport } from './obstacles';

export interface Convoy {
  id: string;
  name: string;
  join_code: string;
  expires_at: string;
}

export async function listConvoys(client: SupabaseClient): Promise<Convoy[]> {
  const { data, error } = await client.from('convoys')
    .select('id,name,join_code,expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as Convoy[];
}

export async function createConvoy(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc('create_convoy', { p_name: name.trim() });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row.convoy_id !== 'string') throw new Error('Convoy creation returned no ID.');
  return row.convoy_id;
}

export async function joinConvoy(client: SupabaseClient, code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(normalized)) throw new Error('Enter the 12-character invite code.');
  const { data, error } = await client.rpc('join_convoy', { p_code: normalized });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Joining returned no convoy ID.');
  return data;
}

export async function listReports(client: SupabaseClient, convoyId: string): Promise<ObstacleReport[]> {
  const { data, error } = await client.from('obstacle_reports')
    .select('id,convoy_id,reporter_id,kind,created_at,expires_at')
    .eq('convoy_id', convoyId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []).map(parseReport).filter((item): item is ObstacleReport => item !== null && isFreshReport(item));
}

export async function sendReport(client: SupabaseClient, convoyId: string, userId: string, kind: ObstacleKind): Promise<ObstacleReport> {
  const { data, error } = await client.from('obstacle_reports')
    .insert({ convoy_id: convoyId, reporter_id: userId, kind })
    .select('id,convoy_id,reporter_id,kind,created_at,expires_at')
    .single();
  if (error) throw error;
  const parsed = parseReport(data);
  if (!parsed) throw new Error('The report was sent, but its response was unreadable.');
  return parsed;
}
