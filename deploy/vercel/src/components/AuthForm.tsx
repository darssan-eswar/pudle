'use client';

import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function AuthForm({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = mode === 'signup'
        ? await client.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: `${window.location.origin}/app` },
          })
        : await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) {
        setMessage('Check your email to finish creating the account, then sign in.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-wrap">
      <div className="auth-note"><span className="eyebrow">YOUR SEAT IN THE CONVOY</span><h1>Let’s get<br/><em>rolling.</em></h1><p>One account per person. You and your friend can join the same private convoy from separate phones.</p></div>
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-tabs" role="group" aria-label="Account action">
          <button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => { setMode('signup'); setMessage(''); }}>Create account</button>
          <button type="button" className={mode === 'signin' ? 'selected' : ''} onClick={() => { setMode('signin'); setMessage(''); }}>Sign in</button>
        </div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" minLength={8} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
        <button className="button button--dark" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'signup' ? 'Create my account' : 'Sign in'}</button>
        {message && <p className="form-message" role="status">{message}</p>}
        <p className="form-small">Reports are visible only to members of your convoy.</p>
      </form>
    </section>
  );
}
