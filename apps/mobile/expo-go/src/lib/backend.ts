// Server calls. Every row is validated again on the phone before it can be spoken.
import { parseHazardRow } from '../core/events';
import { RoadCorridor, type Point } from '../core/relevance';
import type { HazardEvent, HazardKind, HazardLocation, HazardSide } from '../core/types';
import { SUPABASE_URL, supabase } from './supabase';

export interface Convoy { id: string; name: string; join_code: string | null; expires_at: string }

const POLICY_VERSION = '2026-10-07';

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return 'Something went wrong';
}

export async function listConvoys(): Promise<Convoy[]> {
  const { data, error } = await supabase.from('convoys').select('id,name,join_code,expires_at')
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(message(error));
  return (data ?? []) as Convoy[];
}

export async function createConvoy(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_convoy', { p_name: name.trim() });
  if (error) throw new Error(message(error));
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.convoy_id) throw new Error('Convoy creation returned no ID.');
  return row.convoy_id as string;
}

export async function joinConvoy(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(normalized)) throw new Error('Enter the 12-character invite code.');
  const { data, error } = await supabase.rpc('join_convoy', { p_code: normalized });
  if (error) throw new Error(message(error));
  return data as string;
}

export async function setLocationConsent(granted: boolean) {
  const { error } = await supabase.rpc('set_location_consent', { p_granted: granted, p_policy_version: POLICY_VERSION });
  if (error) throw new Error(message(error));
}

export async function fetchEvents(convoyId: string, now: number): Promise<{ events: HazardEvent[]; rejected: number }> {
  const { data, error } = await supabase.from('hazard_events')
    .select('id,schema_version,convoy_id,reporter_id,kind,source,side,blocks_road,observed_at,created_at,expires_at,latitude,longitude,accuracy_m,heading_deg')
    .eq('convoy_id', convoyId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(message(error));
  const events: HazardEvent[] = [];
  let rejected = 0;
  for (const raw of data ?? []) {
    const result = parseHazardRow(raw, convoyId, now);
    if (result.ok) events.push(result.event); else rejected++;
  }
  return { events: events.sort((a, b) => a.createdAt - b.createdAt), rejected };
}

export async function fetchCorridor(convoyId: string): Promise<RoadCorridor | null> {
  const { data, error } = await supabase.from('road_corridors').select('id,name,points')
    .eq('convoy_id', convoyId).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(message(error));
  const row = data?.[0];
  if (!row || !Array.isArray(row.points)) return null;
  const points = (row.points as unknown[]).filter((p): p is Point =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'));
  return RoadCorridor.create(row.id, row.name, points);
}

export async function saveCorridor(convoyId: string, name: string, points: Point[]) {
  const rounded = points.map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
  const { error } = await supabase.rpc('save_corridor', { p_convoy_id: convoyId, p_name: name, p_points: rounded });
  if (error) throw new Error(message(error));
}

export interface ReportInput {
  convoyId: string; kind: HazardKind; side: HazardSide; blocksRoad: boolean;
  source: 'convoy_member' | 'driver_confirmed_camera'; observedAt: number; location: HazardLocation | null;
}

export async function report(input: ReportInput) {
  const params: Record<string, unknown> = {
    p_convoy_id: input.convoyId, p_kind: input.kind, p_client_event_id: newUUID(),
    p_observed_at: new Date(input.observedAt).toISOString(), p_source: input.source,
    p_side: input.side, p_blocks_road: input.blocksRoad,
  };
  if (input.location) {
    params.p_latitude = input.location.latitude;
    params.p_longitude = input.location.longitude;
    params.p_accuracy_m = Math.min(Math.max(input.location.accuracyMeters, 1), 100);
    if (input.location.headingDegrees != null) params.p_heading_deg = input.location.headingDegrees;
  }
  const { error } = await supabase.rpc('report_hazard', params);
  if (error) throw new Error(message(error));
}

export interface Detection {
  hazard: boolean; kind: string; side: string; blocks_road: boolean; confidence: number; label: string; latency_ms?: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in first');
  return {
    Authorization: `Bearer ${token}`,
    apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    'Content-Type': 'application/json',
  };
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Sends one small JPEG (base64) to the detect-hazard edge function (Gemini). Nothing is stored. */
export async function detectHazard(jpegBase64: string): Promise<Detection> {
  const res = await withTimeout(`${SUPABASE_URL}/functions/v1/detect-hazard`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ image: jpegBase64 }),
  }, 10_000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Hazard checker error ${res.status}`);
  return json as Detection;
}

/** Gemini voice for a fixed phrase. Returns WAV bytes as base64. */
export async function synthesize(text: string, persona: string, timeoutMs: number): Promise<string> {
  const res = await withTimeout(`${SUPABASE_URL}/functions/v1/speak`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ text, persona }),
  }, timeoutMs);
  if (!res.ok) throw new Error(`Voice error ${res.status}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  return bytesToBase64(buffer);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}

export function newUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
