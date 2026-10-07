// Deterministic spoken copy. Ported from AlertPhrases.swift. Rules: every report phrase says who
// reported it; only "ahead" relevance says "ahead" or a distance; blockages are always "possible".
import type { Relevance } from './relevance';
import type { HazardEvent, HazardKind, HazardSide } from './types';

export type Units = 'imperial' | 'metric';
export const PERSONAS = ['copilot', 'buddy', 'pro', 'hype'] as const;
export type Persona = (typeof PERSONAS)[number];
export const PERSONA_NAMES: Record<Persona, string> = {
  copilot: 'Calm co-pilot', buddy: 'Chill buddy', pro: 'Professional', hype: 'Hype',
};
const OPENER: Record<Persona, string> = {
  copilot: 'Heads up.', buddy: 'Yo, heads up.', pro: 'Caution.', hype: 'Whoa, heads up!',
};

export const LABEL: Record<HazardKind, string> = {
  tree: 'Tree or branch in road', debris: 'Debris in road', stopped_vehicle: 'Stopped vehicle',
  animal: 'Animal on road', pothole: 'Large pothole', object: 'Object in road', other: 'Road obstruction',
};
const NOUN: Record<HazardKind, string> = {
  tree: 'a fallen branch', debris: 'some debris', stopped_vehicle: 'a stopped vehicle', animal: 'an animal',
  pothole: 'a big pothole', object: 'something', other: 'an obstruction',
};
const BARE: Record<HazardKind, string> = {
  tree: 'fallen branch', debris: 'debris', stopped_vehicle: 'stopped vehicle', animal: 'animal',
  pothole: 'pothole', object: 'object', other: 'obstruction',
};
const SIDE: Record<HazardSide, string | null> = {
  left: 'on the left side of the road', right: 'on the right side of the road', center: 'in the middle of the lane', unknown: null,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function spokenDistance(meters: number, units: Units): string {
  if (units === 'metric') {
    if (meters < 1000) return `about ${Math.max(100, Math.round(meters / 100) * 100)} meters`;
    const km = Math.round(meters / 500) / 2;
    return Number.isInteger(km) ? `about ${km} kilometers` : `about ${km.toFixed(1)} kilometers`;
  }
  const feet = meters * 3.28084;
  if (feet < 1000) return `about ${Math.max(100, Math.round(feet / 100) * 100)} feet`;
  const miles = meters / 1609.344;
  if (miles < 0.375) return 'about a quarter mile';
  if (miles < 0.75) return 'about half a mile';
  const halves = Math.round(miles * 2) / 2;
  if (halves === 1) return 'about a mile';
  return Number.isInteger(halves) ? `about ${halves} miles` : `about ${halves.toFixed(1)} miles`;
}

/** Returns null when the event must not be spoken. */
export function phraseFor(event: HazardEvent, relevance: Relevance, units: Units, persona: Persona = 'copilot'): string | null {
  if (relevance.type === 'notRelevant') return null;
  if (event.source === 'labeled_test') {
    const what = cap(NOUN[event.kind]);
    return relevance.type === 'ahead'
      ? `Pudle test alert. ${what}, ${spokenDistance(relevance.meters, units)} ahead. This is a demo, not a real report.`
      : `Pudle test alert. ${what}. This is a demo, not a real report.`;
  }
  const who = event.source === 'driver_confirmed_camera' ? 'a Pudle driver' : 'a convoy member';
  const what = NOUN[event.kind];
  const side = SIDE[event.side] ? ` ${SIDE[event.side]}` : '';
  const open = OPENER[persona];
  switch (relevance.type) {
    case 'ahead': {
      const d = spokenDistance(relevance.meters, units);
      if (event.blocksRoad) return `${open} Possible road blockage ${d} ahead: ${what}, reported by ${who}. You might want to reroute.`;
      return `${open} ${cap(what)}${side}, ${d} ahead, reported by ${who}.`;
    }
    case 'nearby':
      return `${open} ${cap(what)} reported nearby by ${who}${event.blocksRoad ? ', possibly blocking the road' : ''}. Direction not verified.`;
    case 'receiverUnknown':
      return `${open} ${LABEL[event.kind]}, reported by ${who}. Your position is unavailable, so location is not verified.`;
    case 'unlocated':
      return `Pudle. ${LABEL[event.kind]}, reported by ${who}. Location not verified.`;
  }
}

/** Asked on the detecting phone. The driver answers with a tap (Expo Go demo). */
export function cameraPrompt(kind: HazardKind, side: HazardSide, blocksRoad: boolean, persona: Persona): string {
  const open = OPENER[persona];
  if (blocksRoad) {
    return `${open} Looks like ${NOUN[kind]} might be blocking the road ahead. Want me to warn drivers behind you so they can take another route?`;
  }
  const s = SIDE[side] ? ` ${SIDE[side]}` : '';
  return `${open} Possible ${BARE[kind]}${s} coming up, in case you didn't notice. Want me to warn drivers behind you?`;
}

export const reportSent = (blocks: boolean) =>
  blocks ? 'Done. I warned drivers behind you about a possible blockage.' : 'Done. I warned drivers behind you.';
export const REPORT_CANCELLED = 'Okay, not reporting it.';
export const REPORT_FAILED = "Sorry, I couldn't send that report. Check the connection.";
export const DRIVE_STARTED = 'Pudle drive started. Keep Pudle on screen.';
export const DRIVE_STOPPED = 'Pudle drive stopped.';
export const FEED_LOST = 'Pudle has lost its connection. New reports cannot arrive.';
export const FEED_RESTORED = 'Pudle is reconnected.';
