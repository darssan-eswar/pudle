'use client';

import { useEffect, useState } from 'react';
import { PudleButton } from '@/components/pudle';
import { INTERESTS, INTEREST_LABELS, TripMemory, type TripInterest } from '@/lib/client/app/trip-memory';

export function TripInterests({ memory, revision, onChange }: {
  memory: TripMemory; revision: number; onChange: () => void;
}) {
  const [topic, setTopic] = useState<TripInterest>('fuel-prices');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const snapshot = memory.snapshot();
  return (
    <section className="pudle-card" aria-labelledby="trip-interests-title" data-revision={revision}>
      <p className="pudle-eyebrow">Private trip memory · preview</p>
      <h2 id="trip-interests-title">What matters on this trip?</h2>
      <p className="pudle-muted">Set up while parked. These interests and confirmed notes stay in this tab;
        they clear on reload or sign-out. No automatic price reading, fuel-gauge monitoring, or vehicle connection is enabled.</p>
      <div className="pudle-trip-interests">
        {INTERESTS.map((interest) => (
          <label key={interest} className="pudle-consent">
            <span>{INTEREST_LABELS[interest]}</span>
            <input type="checkbox" checked={snapshot.interests.includes(interest)} onChange={(event) => {
              if (event.target.checked) memory.remember(interest); else memory.forget(interest);
              onChange();
            }} />
          </label>
        ))}
      </div>
      <form className="pudle-trip-note" onSubmit={(event) => {
        event.preventDefault();
        try { memory.add(topic, text); setText(''); setError(''); onChange(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Note could not be saved.'); }
      }}>
        <label className="pudle-field">Note category<select value={topic} onChange={(event) => setTopic(event.target.value as TripInterest)}>
          {INTERESTS.map((interest) => <option key={interest} value={interest}>{INTEREST_LABELS[interest]}</option>)}
        </select></label>
        <label className="pudle-field">Confirmed observation<input value={text} maxLength={180} onChange={(event) => setText(event.target.value)}
          placeholder="Example: regular, $3.49/gal, cash price" /></label>
        <PudleButton type="submit" disabled={!snapshot.interests.includes(topic) || !text.trim()}>Keep note temporarily</PudleButton>
      </form>
      {error ? <p role="alert" className="pudle-inline-error">{error}</p> : null}
      <p className="pudle-muted">Fuel-price notes expire after 2 hours; charging after 15 minutes; rest stops after 1 hour.
        Notes are personal context, never safety alerts or availability guarantees.</p>
      {snapshot.notes.length ? <ul>{snapshot.notes.map((note) => (
        <li key={note.id}>{INTEREST_LABELS[note.topic]}: {note.text}{' '}
          <small>· confirmed by you · expires {new Date(note.expiresAt).toLocaleTimeString()}</small></li>
      ))}</ul> : <p>No fresh notes yet.</p>}
      <PudleButton variant="secondary" onClick={() => { memory.clear(); onChange(); }}>Clear trip memory</PudleButton>
    </section>
  );
}
