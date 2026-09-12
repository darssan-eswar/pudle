'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createRideApi,
  RideApiError,
  type RideApi,
  type RideGroup,
  type RideMessage,
} from '../../lib/client/app/ride-api';

export interface AppRideUser {
  /** Used only to reset account-scoped browser state; it is never sent to the ride API. */
  id: string;
  displayName: string;
}

export interface AppRideProps {
  currentUser: AppRideUser;
  api?: RideApi;
  /** Test seam; production polling is clamped to 3–5 seconds. */
  pollIntervalMs?: number;
}

type ConnectionState = 'online' | 'offline' | 'reconnecting';

const controlStyle = { minHeight: 48 };

function messageFor(error: unknown): string {
  if (error instanceof RideApiError || error instanceof Error) return error.message;
  return 'Unable to complete the ride request.';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function mergeMessages(current: RideMessage[], incoming: RideMessage[]): RideMessage[] {
  const known = new Set(current.map(({ id }) => id));
  const merged = [...current];
  for (const message of incoming) {
    if (!known.has(message.id)) {
      known.add(message.id);
      merged.push(message);
    }
  }
  return merged.sort((left, right) => left.createdAt - right.createdAt);
}

function monotonicCursor(current: string | null, next: string | null): string | null {
  if (next === null) return current;
  if (current === null) return next;
  return BigInt(next) >= BigInt(current) ? next : current;
}

function freshIdempotencyKey(): string {
  return `ride-${crypto.randomUUID()}`;
}

export function AppRide({
  currentUser,
  api: suppliedApi,
  pollIntervalMs = 4_000,
}: AppRideProps) {
  const api = useMemo(() => suppliedApi ?? createRideApi(), [suppliedApi]);
  const interval = Math.min(5_000, Math.max(3_000, pollIntervalMs));
  const accountAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const messageCursorRef = useRef<string | null>(null);
  const loadedMessageGroupRef = useRef<string | null>(null);
  const [groups, setGroups] = useState<RideGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [groupName, setGroupName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [redeemToken, setRedeemToken] = useState('');
  const [draft, setDraft] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [connection, setConnection] = useState<ConnectionState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  const selectedGroup = groups.find(({ id }) => id === selectedGroupId) ?? null;

  const loadGroups = useCallback(async (signal: AbortSignal, preferredGroupId?: string) => {
    setLoadingGroups(true);
    setError('');
    try {
      const result = await api.listGroups(signal);
      setGroups(result);
      setSelectedGroupId((current) => {
        if (preferredGroupId && result.some(({ id }) => id === preferredGroupId)) return preferredGroupId;
        if (current && result.some(({ id }) => id === current)) return current;
        return result[0]?.id ?? null;
      });
    } catch (caught) {
      if (!isAbort(caught)) setError(messageFor(caught));
    } finally {
      if (!signal.aborted) setLoadingGroups(false);
    }
  }, [api]);

  const resetAccountAndLoad = useCallback((controller: AbortController) => {
    setGroups([]);
    setSelectedGroupId(null);
    setMessages([]);
    setInviteToken('');
    messageCursorRef.current = null;
    loadedMessageGroupRef.current = null;
    void loadGroups(controller.signal);
  }, [loadGroups]);

  useEffect(() => {
    const controller = new AbortController();
    accountAbortRef.current?.abort();
    accountAbortRef.current = controller;
    queueMicrotask(() => {
      if (!controller.signal.aborted) resetAccountAndLoad(controller);
    });
    return () => {
      controller.abort();
      if (accountAbortRef.current === controller) accountAbortRef.current = null;
    };
  }, [currentUser.id, resetAccountAndLoad]);

  useEffect(() => () => {
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = null;
  }, [currentUser.id, selectedGroupId]);

  useEffect(() => {
    const offline = () => {
      setConnection('offline');
      setLoadingMessages(false);
    };
    const online = () => setConnection('reconnecting');
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);

  const resetMessagesForGroup = useCallback((messageGroupKey: string | null) => {
    loadedMessageGroupRef.current = messageGroupKey;
    messageCursorRef.current = null;
    setMessages([]);
    setLoadingMessages(messageGroupKey !== null);
  }, []);

  useEffect(() => {
    const messageGroupKey = selectedGroupId ? `${currentUser.id}:${selectedGroupId}` : null;
    if (loadedMessageGroupRef.current !== messageGroupKey) {
      resetMessagesForGroup(messageGroupKey);
    }
    if (!selectedGroupId || connection === 'offline') return;

    const controller = new AbortController();
    let timer: number | undefined;
    let active = true;
    let polling = false;

    const poll = async () => {
      if (!active || polling) return;
      if (!navigator.onLine) {
        setConnection('offline');
        return;
      }
      polling = true;
      try {
        const page = await api.listMessages(selectedGroupId, messageCursorRef.current, controller.signal);
        if (!active) return;
        messageCursorRef.current = monotonicCursor(messageCursorRef.current, page.nextCursor);
        setMessages((current) => mergeMessages(current, page.messages));
        setError('');
        setConnection('online');
      } catch (caught) {
        if (!active || isAbort(caught)) return;
        setError(messageFor(caught));
        setConnection(navigator.onLine ? 'reconnecting' : 'offline');
      } finally {
        polling = false;
        if (active) {
          setLoadingMessages(false);
          timer = window.setTimeout(poll, interval);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, connection, currentUser.id, interval, resetMessagesForGroup, selectedGroupId]);

  const runMutation = useCallback(async (
    label: string,
    operation: (signal: AbortSignal) => Promise<void>,
  ) => {
    const accountSignal = accountAbortRef.current?.signal;
    if (!accountSignal || accountSignal.aborted) return;
    if (!navigator.onLine) {
      setConnection('offline');
      setError('You are offline. Reconnect to update your ride.');
      return;
    }
    mutationAbortRef.current?.abort();
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    const abortForAccountChange = () => controller.abort();
    accountSignal.addEventListener('abort', abortForAccountChange, { once: true });
    setBusy(label);
    setError('');
    try {
      await operation(controller.signal);
    } catch (caught) {
      if (!isAbort(caught)) setError(messageFor(caught));
    } finally {
      accountSignal.removeEventListener('abort', abortForAccountChange);
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
      if (!accountSignal.aborted) setBusy(null);
    }
  }, []);

  const createGroup = (event: FormEvent) => {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    void runMutation('create-group', async (signal) => {
      const group = await api.createGroup(name, signal);
      setGroups((current) => [...current.filter(({ id }) => id !== group.id), group]);
      setSelectedGroupId(group.id);
      setGroupName('');
    });
  };

  const createInvite = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedGroup) return;
    const email = inviteEmail.trim();
    if (!email) return;
    void runMutation('create-invite', async (signal) => {
      const invite = await api.createInvite(selectedGroup.id, email, signal);
      setInviteToken(invite.token);
      setInviteEmail('');
      setCopyStatus('');
    });
  };

  const redeemInvite = (event: FormEvent) => {
    event.preventDefault();
    const token = redeemToken.trim();
    if (!token) return;
    void runMutation('redeem-invite', async (signal) => {
      const membership = await api.redeemInvite(token, signal);
      setRedeemToken('');
      await loadGroups(signal, membership.groupId);
    });
  };

  const leaveGroup = () => {
    if (!selectedGroup) return;
    void runMutation('leave-group', async (signal) => {
      await api.leaveGroup(selectedGroup.id, signal);
      setGroups((current) => current.filter(({ id }) => id !== selectedGroup.id));
      setSelectedGroupId(null);
      setMessages([]);
    });
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedGroup) return;
    const body = draft.trim();
    if (!body) return;
    const key = freshIdempotencyKey();
    void runMutation('send-message', async (signal) => {
      const sent = await api.sendMessage(selectedGroup.id, body, key, signal);
      setMessages((current) => mergeMessages(current, [{
        ...sent,
        displayName: currentUser.displayName,
      }]));
      setDraft('');
    });
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteToken);
      setCopyStatus('Invite code copied.');
    } catch {
      setCopyStatus('Could not copy. Select the invite code and copy it manually.');
    }
  };

  return (
    <section className="pudle-card pudle-ride" aria-labelledby="app-ride-title">
      <header className="pudle-panel-header">
        <div>
          <p className="pudle-eyebrow">Private ride groups</p>
          <h1 id="app-ride-title">Ride with {currentUser.displayName}</h1>
        </div>
        <span role="status" aria-live="polite">
          {connection === 'offline' ? 'Offline' : connection === 'reconnecting' ? 'Reconnecting…' : 'Online'}
        </span>
      </header>

      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="pudle-button pudle-button--secondary"
            style={controlStyle}
            onClick={() => {
              const signal = accountAbortRef.current?.signal;
              if (signal) void loadGroups(signal, selectedGroupId ?? undefined);
            }}
          >
            Retry groups
          </button>
        </div>
      ) : null}

      {connection === 'offline' ? (
        <p role="status">Messages are paused while offline. They will reconnect automatically.</p>
      ) : null}

      <form onSubmit={createGroup}>
        <label className="pudle-field">
          <span>New group name</span>
          <input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            maxLength={80}
            style={controlStyle}
            required
          />
        </label>
        <button
          className="pudle-button pudle-button--primary"
          style={controlStyle}
          disabled={busy !== null || connection === 'offline'}
        >
          {busy === 'create-group' ? 'Creating…' : 'Create group'}
        </button>
      </form>

      <form onSubmit={redeemInvite}>
        <label className="pudle-field">
          <span>Invite code</span>
          <input
            value={redeemToken}
            onChange={(event) => setRedeemToken(event.target.value)}
            maxLength={128}
            autoComplete="off"
            style={controlStyle}
            required
          />
        </label>
        <button
          className="pudle-button pudle-button--secondary"
          style={controlStyle}
          disabled={busy !== null || connection === 'offline'}
        >
          {busy === 'redeem-invite' ? 'Joining…' : 'Join group'}
        </button>
      </form>

      <section aria-labelledby="ride-groups-title">
        <h2 id="ride-groups-title">Your groups</h2>
        {loadingGroups ? <p role="status">Loading groups…</p> : groups.length === 0 ? (
          <p>No groups yet. Create one or enter an invite code.</p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="pudle-button pudle-button--quiet"
                  style={controlStyle}
                  aria-pressed={group.id === selectedGroupId}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  {group.name} · {group.role}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedGroup ? (
        <section aria-labelledby="selected-ride-title">
          <header>
            <h2 id="selected-ride-title">{selectedGroup.name}</h2>
            {selectedGroup.role === 'owner' ? (
              <p>The group owner cannot leave this demo group.</p>
            ) : (
              <button
                type="button"
                className="pudle-button pudle-button--danger"
                style={controlStyle}
                disabled={busy !== null || connection === 'offline'}
                onClick={leaveGroup}
              >
                {busy === 'leave-group' ? 'Leaving…' : 'Leave group'}
              </button>
            )}
          </header>

          {selectedGroup.role === 'owner' ? (
            <form onSubmit={createInvite}>
              <label className="pudle-field">
                <span>Email to invite</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  maxLength={254}
                  style={controlStyle}
                  required
                />
              </label>
              <button
                className="pudle-button pudle-button--secondary"
                style={controlStyle}
                disabled={busy !== null || connection === 'offline'}
              >
                {busy === 'create-invite' ? 'Creating invite…' : 'Create invite'}
              </button>
            </form>
          ) : null}

          {inviteToken ? (
            <div>
              <label className="pudle-field">
                <span>Invite code</span>
                <input value={inviteToken} readOnly style={controlStyle} aria-describedby="invite-copy-status" />
              </label>
              <button
                type="button"
                className="pudle-button pudle-button--secondary"
                style={controlStyle}
                onClick={() => void copyInvite()}
              >
                Copy code
              </button>
              <p id="invite-copy-status" role="status">{copyStatus}</p>
            </div>
          ) : null}

          <h3>Messages</h3>
          {loadingMessages ? <p role="status">Loading messages…</p> : messages.length === 0 ? (
            <p>No messages yet. Send the first short update.</p>
          ) : (
            <ol aria-label="Ride messages">
              {messages.map((message) => (
                <li key={message.id}>
                  <strong>{message.displayName}</strong>
                  <p>{message.body}</p>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ol>
          )}

          <form onSubmit={sendMessage}>
            <label className="pudle-field">
              <span>Message your ride</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1_000}
                rows={2}
                style={controlStyle}
                disabled={connection === 'offline'}
              />
            </label>
            <button
              className="pudle-button pudle-button--primary"
              style={controlStyle}
              disabled={busy !== null || connection === 'offline' || !draft.trim()}
            >
              {busy === 'send-message' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

export default AppRide;
