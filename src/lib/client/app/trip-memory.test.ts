import { describe, expect, it } from 'vitest';
import { TripMemory } from './trip-memory';
import { parsePudyRequest } from './pudy';

describe('private trip memory', () => {
  it('expires notes, bounds retention, and separates sessions', () => {
    let now = 1_000;
    const memory = new TripMemory(() => now);
    expect(() => memory.add('charging', 'Available')).toThrow();
    memory.remember('charging');
    memory.add('charging', 'Two stalls, observed while parked');
    expect(new TripMemory().snapshot().notes).toEqual([]);
    now += 15 * 60_000;
    expect(memory.snapshot().notes).toEqual([]);
    memory.add('charging', 'Updated observation');
    memory.forget('charging');
    expect(memory.snapshot().notes).toEqual([]);
    expect(() => memory.remember('emergency' as never)).toThrow();
  });
  it('recognizes explicit preferences without treating them as critical alerts', () => {
    expect(parsePudyRequest('Hey Pudy gas prices are important to me', true))
      .toEqual({ kind: 'action', action: 'remember-fuel-prices' });
    expect(parsePudyRequest('Hey Pudy remember charging stations', true))
      .toEqual({ kind: 'action', action: 'remember-charging' });
    expect(parsePudyRequest('gas prices are important to me', true).kind).toBe('missing-wake-phrase');
    expect(parsePudyRequest("Hey Pudy don't remember gas prices", true).kind).toBe('unknown');
    expect(parsePudyRequest('Hey Pudy charging is not important to me', true).kind).toBe('unknown');
    expect(parsePudyRequest('Hey Pudy forget charging', true).kind).toBe('unknown');
  });
});
