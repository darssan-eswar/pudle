export const OBSTACLE_KINDS = ['tree', 'debris', 'stopped_vehicle', 'other'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export const OBSTACLE_LABELS: Record<ObstacleKind, string> = {
  tree: 'Tree or branch in road',
  debris: 'Debris in road',
  stopped_vehicle: 'Stopped vehicle',
  other: 'Other obstruction',
};

export interface ObstacleReport {
  id: string;
  convoy_id: string;
  reporter_id: string;
  kind: ObstacleKind;
  created_at: string;
  expires_at: string;
}

const kinds = new Set<string>(OBSTACLE_KINDS);

export function parseReport(value: unknown): ObstacleReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.convoy_id !== 'string'
    || typeof row.reporter_id !== 'string' || typeof row.kind !== 'string'
    || !kinds.has(row.kind) || typeof row.created_at !== 'string'
    || typeof row.expires_at !== 'string') return null;
  if (!Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.expires_at))) return null;
  return row as unknown as ObstacleReport;
}

export function isFreshReport(report: ObstacleReport, now = Date.now()): boolean {
  const created = Date.parse(report.created_at);
  return created <= now + 10_000 && created >= now - 120_000 && Date.parse(report.expires_at) > now;
}

export function alertCopy(kind: ObstacleKind): string {
  return `Pudle. ${OBSTACLE_LABELS[kind]} reported by a convoy member. Check the road you can see.`;
}
