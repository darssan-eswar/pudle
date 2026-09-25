'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { AuthForm } from './AuthForm';
import { createConvoy, joinConvoy, listConvoys, sendReport, type Convoy } from '@/lib/convoys';
import { alertCopy, OBSTACLE_KINDS, OBSTACLE_LABELS, type ObstacleKind } from '@/lib/obstacles';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useObstacleFeed } from '@/lib/use-obstacle-feed';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function ConvoyApp() {
  const client = useMemo(() => supabaseConfigured() ? supabase() : null, []);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [convoys, setConvoys] = useState<Convoy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('Our drive');
  const [joinCode, setJoinCode] = useState('');
  const [kind, setKind] = useState<ObstacleKind>('tree');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const activeUserId = useRef<string | null>(null);
  const selected = convoys.find((item) => item.id === selectedId) ?? null;
  const { reports, latestAlert, status: feedStatus, error: feedError } = useObstacleFeed(client, selectedId, user?.id ?? null, audioEnabled);

  useEffect(() => {
    if (!client) { queueMicrotask(() => setUser(null)); return; }
    let mounted = true;
    void client.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user);
    }).catch(() => { if (mounted) setUser(null); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        const nextId = session?.user?.id ?? null;
        if (activeUserId.current !== nextId) {
          activeUserId.current = nextId;
          setConvoys([]);
          setSelectedId(null);
          setAudioEnabled(false);
        }
        setUser(session?.user ?? null);
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [client]);

  const reloadConvoys = useCallback(async (preferredId?: string, expectedUserId?: string) => {
    if (!client) return;
    const next = await listConvoys(client);
    if (expectedUserId && activeUserId.current !== expectedUserId) return;
    setConvoys(next);
    setSelectedId((current) => {
      if (preferredId && next.some((item) => item.id === preferredId)) return preferredId;
      if (current && next.some((item) => item.id === current)) return current;
      return next[0]?.id ?? null;
    });
  }, [client]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void reloadConvoys(undefined, userId).catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    });
    return () => { active = false; };
  }, [userId, reloadConvoys]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const id = await createConvoy(client, name);
      await reloadConvoys(id, user?.id);
      setNotice('Convoy made. Share its code with the second phone.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const id = await joinConvoy(client, joinCode);
      await reloadConvoys(id, user?.id);
      setJoinCode('');
      setNotice('You joined the convoy. Keep this page open to receive reports.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function report() {
    if (!client || !selected || !user || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await sendReport(client, selected.id, user.id, kind);
      setReviewing(false);
      setNotice(`${OBSTACLE_LABELS[kind]} sent to this convoy.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  function enableAudio() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setError('This browser cannot speak reports. Visual reports still work.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('Pudle audio is ready.');
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
    setAudioEnabled(true);
    setNotice('Audio on. Keep the page open on the following phone.');
  }

  async function signOut() {
    if (!client) return;
    window.speechSynthesis?.cancel();
    await client.auth.signOut();
    setNotice(''); setError('');
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link href="/" className="brand"><span className="brand-mark">p.</span> pudle</Link>
        {user && <div className="account-line"><span className="account-email">{user.email}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>}
      </header>

      {!client ? (
        <section className="setup-card"><p className="eyebrow">SETUP NEEDED</p><h1>Waiting for Supabase.</h1><p>The app needs its project URL and publishable key in Vercel before anyone can create an account.</p></section>
      ) : user === undefined ? (
        <div className="loading-state" role="status">Opening Pudle…</div>
      ) : !user ? <AuthForm client={client} /> : (
        <div className="dashboard">
          <div className="dashboard-intro"><p className="eyebrow">ROAD OBSTACLE DEMO</p><h1>Stay a step<br/><em>together.</em></h1><p>Create a convoy or join one. A report on the first phone appears on the second and can be read aloud.</p></div>

          {error && <p className="error-banner" role="alert">{error}</p>}
          {notice && <p className="notice-banner" role="status">{notice}</p>}

          <div className="dashboard-grid">
            <section className="panel convoy-panel" aria-labelledby="convoy-heading">
              <div className="panel-heading"><span className="panel-index">01 / CONNECT</span><h2 id="convoy-heading">Your convoy</h2></div>
              {convoys.length > 1 && <label className="field-label" htmlFor="convoy-select">Active convoy</label>}
              {convoys.length > 1 && <select id="convoy-select" value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{convoys.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
              {selected ? (
                <div className="active-convoy"><p className="eyebrow">CONNECTED TO</p><h3>{selected.name}</h3><p>Share this code with your friend</p><strong className="join-code">{selected.join_code}</strong><span className="expiry-note">Code and convoy expire in 24 hours.</span></div>
              ) : <p className="empty-copy">No convoy yet. Start one on the lead phone, then join from the following phone.</p>}
              <details className="setup-details" open={!selected}>
                <summary>{selected ? 'Create or join another' : 'Create or join'}</summary>
                <form onSubmit={(event) => void create(event)}><label htmlFor="convoy-name">Create a convoy</label><div className="field-row"><input id="convoy-name" maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} /><button className="button button--outline" disabled={busy}>Create</button></div></form>
                <form onSubmit={(event) => void join(event)}><label htmlFor="join-code">Join with a code</label><div className="field-row"><input id="join-code" maxLength={12} pattern="[A-Fa-f0-9]{12}" placeholder="12-character code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} /><button className="button button--outline" disabled={busy || !joinCode}>Join</button></div></form>
              </details>
            </section>

            <section className="panel report-panel" aria-labelledby="report-heading">
              <div className="panel-heading"><span className="panel-index">02 / REPORT</span><h2 id="report-heading">Obstacle in the road?</h2></div>
              <p className="panel-copy">A passenger in the lead car can confirm what they see. The report is visible only to this convoy for two minutes.</p>
              <label className="field-label" htmlFor="kind">What was seen?</label>
              <select id="kind" value={kind} onChange={(event) => { setKind(event.target.value as ObstacleKind); setReviewing(false); }} disabled={!selected}>{OBSTACLE_KINDS.map((item) => <option value={item} key={item}>{OBSTACLE_LABELS[item]}</option>)}</select>
              {reviewing ? <div className="report-review"><strong>Send “{OBSTACLE_LABELS[kind]}” to {selected?.name}?</strong><p>Only send what someone has actually observed.</p><div className="review-actions"><button className="button button--coral" disabled={busy} onClick={() => void report()}>{busy ? 'Sending…' : 'Confirm & send'}</button><button className="text-button" onClick={() => setReviewing(false)}>Cancel</button></div></div> : <button className="button button--coral report-start" disabled={!selected || busy} onClick={() => setReviewing(true)}>Review road report <span aria-hidden="true">↗</span></button>}
              <p className="tiny-note">Set up before driving. Do not use the screen while operating a vehicle.</p>
            </section>

            <section className="panel listen-panel" aria-labelledby="listen-heading">
              <div className="panel-heading"><span className="panel-index">03 / LISTEN</span><h2 id="listen-heading">On the following phone</h2></div>
              <p className="panel-copy">Keep Pudle open in the foreground. Visual reports work on their own; spoken playback needs one tap to enable.</p>
              <button className={`button ${audioEnabled ? 'button--soft' : 'button--dark'}`} onClick={() => {
                if (audioEnabled) { window.speechSynthesis?.cancel(); setAudioEnabled(false); }
                else enableAudio();
              }}>{audioEnabled ? 'Audio on · tap to mute' : 'Enable spoken reports'}</button>
              <div className="connection-line"><span className={`connection-dot ${feedStatus === 'live' ? 'connected' : ''}`}/>{selected ? feedStatus === 'live' ? 'Live connection · refresh backup on' : 'Reconnecting · refresh backup on' : 'Join a convoy to listen'}</div>
              {feedError && <p className="form-message" role="status">{feedError}</p>}
            </section>
          </div>

          <section className="feed-section" aria-labelledby="feed-heading"><div className="feed-title"><div><p className="eyebrow">THE LATEST</p><h2 id="feed-heading">Road reports</h2></div><span>Last two minutes</span></div>
            {latestAlert && <div className="alert-card" role="alert"><span className="alert-icon">!</span><div><strong>{OBSTACLE_LABELS[latestAlert.kind]}</strong><p>{alertCopy(latestAlert.kind)}</p></div></div>}
            {reports.length ? <ol className="report-list">{reports.map((item) => <li key={item.id}><span className="report-symbol">✳</span><div><strong>{OBSTACLE_LABELS[item.kind]}</strong><span>{item.reporter_id === user.id ? 'You reported this' : 'Convoy member reported this'}</span></div><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></li>)}</ol> : <div className="feed-empty">Nothing reported yet. That is a good thing.</div>}
          </section>
        </div>
      )}
    </main>
  );
}
