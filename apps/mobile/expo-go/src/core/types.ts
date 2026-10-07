// Event contracts shared with the database (hazard_events v1). Ported from PudleCore.
export const HAZARD_KINDS = ['tree', 'debris', 'stopped_vehicle', 'animal', 'pothole', 'object', 'other'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export const SIDES = ['left', 'right', 'center', 'unknown'] as const;
export type HazardSide = (typeof SIDES)[number];
export type HazardSource = 'convoy_member' | 'driver_confirmed_camera' | 'labeled_test';

export interface HazardLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  headingDegrees?: number | null;
}

export interface HazardEvent {
  id: string;
  kind: HazardKind;
  source: HazardSource;
  side: HazardSide;
  blocksRoad: boolean;
  convoyId?: string;
  reporterId?: string;
  observedAt: number; // epoch ms
  createdAt: number;
  expiresAt: number;
  location?: HazardLocation | null;
}

export interface ReceiverFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  courseDegrees?: number | null;
  speedMps?: number | null;
  timestamp: number; // epoch ms
}

export function isValidLocation(l: HazardLocation): boolean {
  if (![l.latitude, l.longitude, l.accuracyMeters].every(Number.isFinite)) return false;
  if (l.latitude < -90 || l.latitude > 90 || l.longitude < -180 || l.longitude > 180) return false;
  if (l.accuracyMeters <= 0 || l.accuracyMeters > 1000) return false;
  if (l.headingDegrees != null && !(l.headingDegrees >= 0 && l.headingDegrees < 360)) return false;
  return true;
}
