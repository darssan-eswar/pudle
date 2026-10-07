// Decides whether an event may be spoken. Ported from AlertPolicy.swift, including both fixes:
// out-of-range reports are re-checked (not consumed), and rate-limited ones are not lost.
import { checkTimes } from './events';
import { distance } from './geo';
import { phraseFor, type Persona, type Units } from './phrases';
import { evaluate, type Relevance, type RoadCorridor } from './relevance';
import type { HazardEvent, HazardKind, HazardLocation, ReceiverFix } from './types';

export type Decision =
  | { type: 'speak'; phrase: string; relevance: Relevance }
  | { type: 'suppress'; reason: string; final: boolean };

export class AlertPolicy {
  active = false;
  muted = false;
  units: Units = 'imperial';
  persona: Persona = 'copilot';
  ownUserId: string | null = null;
  corridor: RoadCorridor | null = null;
  maxPerMinute = 4;
  similarRadius = 200;
  similarWindowMs = 120_000;
  private consumed = new Map<string, number>();
  private spoken: { kind: HazardKind; location: HazardLocation | null | undefined; at: number }[] = [];

  get consumedCount() { return this.consumed.size; }

  decide(event: HazardEvent, receiver: ReceiverFix | null, now: number): Decision {
    this.prune(now);
    if (!this.active) return { type: 'suppress', reason: 'drive not active', final: true };
    if (this.consumed.has(event.id)) return { type: 'suppress', reason: 'duplicate', final: true };
    const times = checkTimes(event, now);
    if (!times.ok) { this.consumed.set(event.id, now + 60_000); return { type: 'suppress', reason: `rejected: ${times.reason}`, final: true }; }
    if (event.source !== 'labeled_test' && this.ownUserId && event.reporterId === this.ownUserId) {
      this.consume(event); return { type: 'suppress', reason: 'your own report', final: true };
    }
    if (this.muted) { this.consume(event); return { type: 'suppress', reason: 'muted (not replayed)', final: true }; }
    const relevance = evaluate(event.location, receiver, now, this.corridor);
    if (relevance.type === 'notRelevant') return { type: 'suppress', reason: `waiting: ${relevance.why}`, final: false };
    if (this.isSimilar(event, now)) { this.consume(event); return { type: 'suppress', reason: 'similar report already announced', final: true }; }
    if (this.spoken.filter((s) => now - s.at < 60_000).length >= this.maxPerMinute) {
      return { type: 'suppress', reason: 'rate limited', final: false };
    }
    const phrase = phraseFor(event, relevance, this.units, this.persona);
    if (!phrase) return { type: 'suppress', reason: 'waiting: no phrase', final: false };
    this.consume(event);
    this.spoken.push({ kind: event.kind, location: event.location, at: now });
    return { type: 'speak', phrase, relevance };
  }

  reset() { this.consumed.clear(); this.spoken = []; }

  private consume(e: HazardEvent) { this.consumed.set(e.id, e.expiresAt); }

  private isSimilar(e: HazardEvent, now: number): boolean {
    if (e.source === 'labeled_test') return false;
    return this.spoken.some((p) => {
      if (p.kind !== e.kind || now - p.at >= this.similarWindowMs) return false;
      if (!p.location && !e.location) return true;
      if (p.location && e.location) {
        return distance(p.location.latitude, p.location.longitude, e.location.latitude, e.location.longitude) <= this.similarRadius;
      }
      return false;
    });
  }

  private prune(now: number) {
    for (const [id, until] of this.consumed) if (until + 90_000 <= now) this.consumed.delete(id);
    this.spoken = this.spoken.filter((s) => now - s.at <= Math.max(this.similarWindowMs, 60_000));
  }
}

/** Smooths per-frame model output into at most one prompt per real hazard. Ported from DetectionFilter. */
export interface Observation { kind: HazardKind; side: import('./types').HazardSide; blocksRoad: boolean; confidence: number; at: number }

export class DetectionFilter {
  minConfidence = 0.55;
  singleFrameConfidence = 0.85;
  windowMs = 5_000;
  cooldownMs = 30_000;
  private recent: Observation[] = [];
  private lastAccepted: number | null = null;

  add(o: Observation | null, now: number): Observation | null {
    this.recent = this.recent.filter((r) => now - r.at <= this.windowMs);
    if (this.lastAccepted != null && now - this.lastAccepted < this.cooldownMs) return null;
    if (!o || o.confidence < this.minConfidence) return null;
    this.recent.push(o);
    const loose = new Set<HazardKind>(['tree', 'debris', 'object', 'other']);
    const agreeing = this.recent.filter((r) => r.kind === o.kind || (loose.has(r.kind) && loose.has(o.kind)));
    if (o.confidence >= this.singleFrameConfidence || agreeing.length >= 2) {
      this.lastAccepted = now;
      this.recent = [];
      const best = agreeing.reduce((a, b) => (b.confidence > a.confidence ? b : a), o);
      return { ...best, blocksRoad: agreeing.some((a) => a.blocksRoad) };
    }
    return null;
  }

  reset() { this.recent = []; this.lastAccepted = null; }
}
