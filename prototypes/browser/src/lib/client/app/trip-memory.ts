export const INTERESTS = ['fuel-prices', 'charging', 'rest-stops'] as const;
export type TripInterest = typeof INTERESTS[number];
export const INTEREST_LABELS: Record<TripInterest, string> = {
  'fuel-prices': 'Fuel prices', charging: 'EV charging', 'rest-stops': 'Rest stops',
};
export interface TripNote {
  id: string;
  topic: TripInterest;
  text: string;
  capturedAt: number;
  expiresAt: number;
  source: 'user-confirmed';
}
const TTL = { 'fuel-prices': 2 * 60 * 60_000, charging: 15 * 60_000, 'rest-stops': 60 * 60_000 };

/** Per-authenticated-session working memory; no raw media, persistence, or upload. */
export class TripMemory {
  private interests = new Map<TripInterest, number>();
  private notes: TripNote[] = [];
  constructor(private now: () => number = Date.now) {}

  remember(topic: TripInterest): void {
    if (!INTERESTS.includes(topic)) throw new Error('Choose a supported interest.');
    this.interests.set(topic, this.now() + 12 * 60 * 60_000);
  }

  forget(topic: TripInterest): void {
    this.interests.delete(topic);
    this.notes = this.notes.filter((note) => note.topic !== topic);
  }

  add(topic: TripInterest, input: string): void {
    this.prune();
    if (!this.interests.has(topic)) throw new Error('Enable this interest first.');
    const text = input.trim();
    if (!text || text.length > 180) throw new Error('Use a note between 1 and 180 characters.');
    const now = this.now();
    this.notes = [...this.notes, {
      id: crypto.randomUUID(), topic, text, capturedAt: now,
      expiresAt: now + TTL[topic], source: 'user-confirmed' as const,
    }].slice(-20);
  }

  snapshot(): { interests: TripInterest[]; notes: TripNote[] } {
    this.prune();
    return { interests: [...this.interests.keys()], notes: this.notes.map((note) => ({ ...note })) };
  }

  clear(): void { this.interests.clear(); this.notes = []; }

  private prune(): void {
    const now = this.now();
    for (const [topic, expiry] of this.interests) if (expiry <= now) this.interests.delete(topic);
    this.notes = this.notes.filter((note) => note.expiresAt > now && this.interests.has(note.topic));
  }
}
