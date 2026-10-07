// "Is this hazard ahead of me on the same road?" Ported from RoadRelevance.swift (PudleCore).
import { angleDifference, bearing, distance } from './geo';
import { isValidLocation, type HazardLocation, type ReceiverFix } from './types';

export type Relevance =
  | { type: 'unlocated' }
  | { type: 'receiverUnknown'; why: string }
  | { type: 'nearby'; meters: number } // close, direction not verified: never "ahead"
  | { type: 'ahead'; meters: number; onRecordedRoad: boolean }
  | { type: 'notRelevant'; why: string }; // re-checked later; not final

export const RULES = {
  maxFixAgeMs: 15_000,
  maxReceiverAccuracy: 50,
  maxHazardAccuracyForAhead: 40,
  minSpeedForCourse: 1.0,
  nearbyRadius: 500,
  aheadMaxDistance: 2_000, // "within about a mile" (1.25 mi)
  aheadMaxBearingOffset: 25,
  maxHeadingDifference: 45,
  maxCrossTrack: 30,
  oppositeHeadingThreshold: 135,
  corridorHalfWidth: 40,
  corridorMaxHeadingDifference: 60,
};

export type Point = [number, number]; // [lat, lon]

export class RoadCorridor {
  readonly cumulative: number[];
  constructor(readonly id: string, readonly name: string, readonly points: Point[]) {
    const c = [0];
    for (let i = 1; i < points.length; i++) {
      c.push(c[i - 1] + distance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
    }
    this.cumulative = c;
  }

  static create(id: string, name: string, points: Point[]): RoadCorridor | null {
    if (points.length < 2) return null;
    const corridor = new RoadCorridor(id, name, points);
    return corridor.length > 20 ? corridor : null;
  }

  get length(): number { return this.cumulative[this.cumulative.length - 1] ?? 0; }

  /** Nearest projection onto the polyline (local flat-earth approximation). */
  project(lat: number, lon: number): { along: number; offset: number; bearing: number } {
    let best = { along: 0, offset: Infinity, bearing: 0 };
    const mLat = 111_320;
    for (let i = 0; i < this.points.length - 1; i++) {
      const [alat, alon] = this.points[i], [blat, blon] = this.points[i + 1];
      const mLon = mLat * Math.cos((alat * Math.PI) / 180);
      const bx = (blon - alon) * mLon, by = (blat - alat) * mLat;
      const px = (lon - alon) * mLon, py = (lat - alat) * mLat;
      const len2 = bx * bx + by * by;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const dx = px - t * bx, dy = py - t * by;
      const off = Math.hypot(dx, dy);
      if (off < best.offset) {
        best = {
          along: this.cumulative[i] + t * (this.cumulative[i + 1] - this.cumulative[i]),
          offset: off,
          bearing: bearing(alat, alon, blat, blon),
        };
      }
    }
    return best;
  }
}

export function evaluate(hazard: HazardLocation | null | undefined, receiver: ReceiverFix | null, now: number,
                         corridor: RoadCorridor | null = null, rules = RULES): Relevance {
  if (!hazard || !isValidLocation(hazard)) return { type: 'unlocated' };
  if (!receiver) return { type: 'receiverUnknown', why: 'no position' };
  if (now - receiver.timestamp > rules.maxFixAgeMs) return { type: 'receiverUnknown', why: 'stale position' };
  if (receiver.accuracyMeters <= 0 || receiver.accuracyMeters > rules.maxReceiverAccuracy) {
    return { type: 'receiverUnknown', why: 'low accuracy' };
  }
  const dist = distance(receiver.latitude, receiver.longitude, hazard.latitude, hazard.longitude);
  const moving = (receiver.speedMps ?? 0) >= rules.minSpeedForCourse;
  const course = receiver.courseDegrees != null && receiver.courseDegrees >= 0 && receiver.courseDegrees < 360
    ? receiver.courseDegrees : null;

  if (corridor) {
    const h = corridor.project(hazard.latitude, hazard.longitude);
    const r = corridor.project(receiver.latitude, receiver.longitude);
    const hazardOn = h.offset <= rules.corridorHalfWidth + hazard.accuracyMeters;
    const receiverOn = r.offset <= rules.corridorHalfWidth + receiver.accuracyMeters;
    if (hazardOn && receiverOn) {
      if (!moving || course == null) {
        return dist <= rules.nearbyRadius ? { type: 'nearby', meters: dist } : { type: 'notRelevant', why: 'on road, direction unknown' };
      }
      const diff = angleDifference(course, r.bearing);
      if (diff >= 180 - rules.corridorMaxHeadingDifference) return { type: 'notRelevant', why: 'opposite direction' };
      if (diff > rules.corridorMaxHeadingDifference) return { type: 'notRelevant', why: 'crossing the road' };
      const ahead = h.along - r.along;
      const slack = hazard.accuracyMeters + receiver.accuracyMeters;
      if (ahead <= -slack) return { type: 'notRelevant', why: 'behind or passed' };
      if (ahead > rules.aheadMaxDistance) return { type: 'notRelevant', why: 'not yet in range' };
      if (ahead <= slack) return { type: 'nearby', meters: dist };
      return { type: 'ahead', meters: ahead, onRecordedRoad: true };
    }
    if (hazardOn && !receiverOn && dist <= rules.aheadMaxDistance) {
      return dist <= 150 ? { type: 'nearby', meters: dist } : { type: 'notRelevant', why: 'off the recorded road' };
    }
  }

  if (!moving || course == null) {
    return dist <= rules.nearbyRadius ? { type: 'nearby', meters: dist } : { type: 'notRelevant', why: 'far while course unknown' };
  }
  if (dist > rules.aheadMaxDistance) return { type: 'notRelevant', why: 'far' };
  const b = bearing(receiver.latitude, receiver.longitude, hazard.latitude, hazard.longitude);
  const off = angleDifference(b, course);
  const uncertainty = hazard.accuracyMeters + receiver.accuracyMeters;
  if (off > 90 && dist > uncertainty) return { type: 'notRelevant', why: 'behind or passed' };
  if (hazard.headingDegrees != null && angleDifference(hazard.headingDegrees, course) >= rules.oppositeHeadingThreshold) {
    return { type: 'notRelevant', why: 'opposite direction' };
  }
  const crossTrack = Math.abs(Math.sin((off * Math.PI) / 180) * dist);
  const headingMatches = hazard.headingDegrees != null && angleDifference(hazard.headingDegrees, course) <= rules.maxHeadingDifference;
  if (headingMatches && off <= rules.aheadMaxBearingOffset && crossTrack <= rules.maxCrossTrack + hazard.accuracyMeters
      && hazard.accuracyMeters <= rules.maxHazardAccuracyForAhead && dist > uncertainty) {
    return { type: 'ahead', meters: dist, onRecordedRoad: false };
  }
  if (dist <= rules.nearbyRadius) return { type: 'nearby', meters: dist };
  return { type: 'notRelevant', why: 'not on heading' };
}

/** Course from recent fixes when GPS course is invalid (slow driving). Fixes oldest first. */
export function estimateCourse(fixes: ReceiverFix[], minDistance = 12, maxAgeMs = 20_000): number | null {
  const last = fixes[fixes.length - 1];
  if (!last || last.accuracyMeters > 30) return null;
  for (let i = fixes.length - 2; i >= 0; i--) {
    const prev = fixes[i];
    if (last.timestamp - prev.timestamp > maxAgeMs) break;
    if (prev.accuracyMeters > 30) continue;
    if (distance(prev.latitude, prev.longitude, last.latitude, last.longitude) >= minDistance) {
      return bearing(prev.latitude, prev.longitude, last.latitude, last.longitude);
    }
  }
  return null;
}
