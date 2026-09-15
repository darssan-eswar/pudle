'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ConnectionStatusBadge,
  PudleButton,
  PudleCreateAccountPanel,
  PudlePrivacyNotice,
  PudleShell,
  PudleSignInPanel,
  PudleStatusBadge,
  type PudleSection,
} from '@/components/pudle';
import {
  AppRecording,
  NearbyEvents,
  PudyAssistant,
  type AppRecordingHandle,
  type PudyAssistantHandle,
} from '@/components/app';
import { AppRide } from '@/components/app/AppRide';
import { RecordingAccountSession } from '@/lib/client/recording';
import {
  authApi,
  authReducer,
  demoApi,
  disposeLocalSession,
  initialAuthState,
  PUDLE_SESSION_EXPIRED_EVENT,
  stopRecordingForPudy,
  type AppUser,
  type PudyAction,
} from '@/lib/client/app';

type NetworkState = 'online' | 'offline' | 'reconnecting';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Pudle could not complete that request.';
}

function AuthenticatedApp({
  user,
  onSignedOut,
}: {
  user: AppUser;
  onSignedOut: () => void;
}) {
  const recordingRef = useRef<AppRecordingHandle>(null);
  const pudyRef = useRef<PudyAssistantHandle>(null);
  const sessionEndingRef = useRef(false);
  const [activeSection, setActiveSection] = useState<PudleSection>('drive');
  const [network, setNetwork] = useState<NetworkState>(
    typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline',
  );
  const [sceneLabels, setSceneLabels] = useState<string[]>([]);
  const [analysisLabels, setAnalysisLabels] = useState<string[]>([]);
  const [nearbyLabels, setNearbyLabels] = useState<string[]>([]);
  const [recordingActive, setRecordingActive] = useState(false);
  const [reportPrepared, setReportPrepared] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);

  const account = useMemo(
    () => new RecordingAccountSession({ ownerId: user.id }),
    [user.id],
  );

  useEffect(() => {
    function offline() {
      setNetwork('offline');
    }
    function online() {
      setNetwork('reconnecting');
      window.setTimeout(() => setNetwork('online'), 900);
    }
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void demoApi.status()
      .then(({ enabled }) => {
        if (active) setDemoModeEnabled(enabled);
      })
      .catch((error) => {
        console.warn('Pudle could not read demo mode status.', error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      recordingRef.current?.stopMedia();
      recordingRef.current?.revokeUrls();
      pudyRef.current?.stop();
      account.dispose();
    },
    [account],
  );

  const handlePudyAction = useCallback(async (action: PudyAction) => {
    if (action === 'prepare-hazard-report') {
      setReportPrepared(true);
      return 'A road report is prepared. Review the observed condition and confirm it on screen before anything is shared.';
    }
    return stopRecordingForPudy(recordingRef.current);
  }, []);

  const disposeSession = useCallback(async () => {
    setAssistantEnabled(false);
    pudyRef.current?.stop();
    await disposeLocalSession({
      stopMedia: () => recordingRef.current?.stopMedia(),
      revokeUrls: () => recordingRef.current?.revokeUrls(),
      closeStorage: () => {
        if (recordingRef.current) recordingRef.current.dispose();
        else account.dispose();
      },
      clearUi: () => {
        setSceneLabels([]);
        setAnalysisLabels([]);
        setNearbyLabels([]);
        setReportPrepared(false);
      },
    });
  }, [account]);

  useEffect(() => {
    function sessionExpired() {
      if (sessionEndingRef.current) return;
      sessionEndingRef.current = true;
      setSigningOut(true);
      setSignOutError('');
      void disposeSession()
        .catch((error) => {
          console.error('Pudle could not completely dispose the expired local session.', error);
        })
        .finally(onSignedOut);
    }

    window.addEventListener(PUDLE_SESSION_EXPIRED_EVENT, sessionExpired);
    return () => window.removeEventListener(PUDLE_SESSION_EXPIRED_EVENT, sessionExpired);
  }, [disposeSession, onSignedOut]);

  async function signOut() {
    if (sessionEndingRef.current) return;
    sessionEndingRef.current = true;
    setSigningOut(true);
    setSignOutError('');
    try {
      await disposeSession();
      await authApi.signOut();
      onSignedOut();
    } catch (error) {
      sessionEndingRef.current = false;
      setSignOutError(`Local media was closed, but the server session could not be ended: ${errorMessage(error)}`);
    }
  }

  if (signingOut) {
    return (
      <div className="pudle-shell pudle-session-loading" role="status">
        {signOutError ? (
          <div className="pudle-card">
            <h1>Sign out needs another try</h1>
            <p className="pudle-inline-error">{signOutError}</p>
            <PudleButton onClick={() => void signOut()}>Retry sign out</PudleButton>
          </div>
        ) : (
          <>
            <span className="pudle-spinner" aria-hidden="true" />
            Closing local media and signing out…
          </>
        )}
      </div>
    );
  }

  return (
    <PudleShell
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      header={<ConnectionStatusBadge status={network} />}
    >
      {network !== 'online' ? (
        <div className="pudle-network" role="status">
          {network === 'offline' ? 'Offline · camera, recording, replay, and local Pudy tools still work.' : 'Connection restored · reconnecting…'}
        </div>
      ) : null}

      <AppRecording
        ref={recordingRef}
        account={account}
        activeSection={activeSection}
        online={network === 'online'}
        onSceneChange={setSceneLabels}
        onCloudAnalysisChange={setAnalysisLabels}
        onRecordingStateChange={setRecordingActive}
      />

      {activeSection === 'drive' ? (
        <>
          <NearbyEvents
            active
            online={network === 'online'}
            reconnecting={network === 'reconnecting'}
            currentUserId={user.id}
            demoModeEnabled={demoModeEnabled}
            preparedByPudy={reportPrepared}
            onPreparedHandled={() => setReportPrepared(false)}
            onNearbyLabelsChange={setNearbyLabels}
          />

          <PudyAssistant
            ref={pudyRef}
            enabled={assistantEnabled}
            sceneLabels={sceneLabels}
            analysisLabels={analysisLabels}
            nearbyLabels={nearbyLabels}
            onAction={handlePudyAction}
          />
        </>
      ) : null}

      {activeSection === 'ride' ? (
        <AppRide
          currentUser={{ id: user.id, displayName: user.displayName }}
        />
      ) : null}

      {activeSection === 'profile' ? (
        <div className="pudle-profile">
          <section className="pudle-card" aria-labelledby="app-profile-title">
            <p className="pudle-eyebrow">Profile</p>
            <h1 id="app-profile-title">{user.displayName}</h1>
            <p className="pudle-muted">{user.email}</p>
            <PudlePrivacyNotice title="Account-scoped local storage">
              This browser keeps a separate recording account session for the stable server identity {user.id.slice(0, 8)}….
            </PudlePrivacyNotice>
            <PudleButton variant="secondary" loading={signingOut} onClick={() => void signOut()}>
              Sign out
            </PudleButton>
          </section>

          <section className="pudle-card" aria-labelledby="app-privacy-title">
            <p className="pudle-eyebrow">Your controls</p>
            <h2 id="app-privacy-title">Privacy</h2>
            <PudlePrivacyNotice title="Recording media stays local">
              Full recordings and raw recording audio never leave this browser. Cloud analysis can send only periodic compressed frames after separate consent. Browser speech recognition may send foreground microphone audio to the browser vendor after Listen is tapped.
            </PudlePrivacyNotice>
            <div className="pudle-preferences">
              <label className="pudle-toggle">
                <span>
                  <strong>Pudy foreground voice</strong>
                  <small>Browser vendor cloud processing may occur only after Listen is tapped.</small>
                </span>
                <input
                  type="checkbox"
                  checked={assistantEnabled}
                  onChange={(event) => setAssistantEnabled(event.target.checked)}
                />
              </label>
              <label className="pudle-toggle">
                <span>
                  <strong>Cloud analysis</strong>
                  <small>Managed independently in Drive with explicit periodic-frame consent.</small>
                </span>
                <input type="checkbox" checked={false} disabled readOnly />
              </label>
            </div>
          </section>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {recordingActive ? 'Recording is active.' : 'Recording is not active.'}
      </span>
    </PudleShell>
  );
}

export default function Home() {
  const [auth, dispatch] = useReducer(authReducer, initialAuthState);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    let active = true;
    void authApi.session()
      .then(({ user }) => {
        if (active) dispatch({ type: 'session-resolved', user });
      })
      .catch((error) => {
        if (active) dispatch({ type: 'failed', message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit() {
    dispatch({ type: 'submit' });
    try {
      const result = mode === 'signup'
        ? await authApi.signUp({ email, password, displayName })
        : await authApi.signIn({ email, password });
      setPassword('');
      dispatch({ type: 'authenticated', user: result.user });
    } catch (error) {
      dispatch({ type: 'failed', message: errorMessage(error) });
    }
  }

  if (auth.status === 'loading') {
    return (
      <div className="pudle-shell pudle-session-loading" role="status">
        <span className="pudle-spinner" aria-hidden="true" />
        Restoring your private session…
      </div>
    );
  }

  if (auth.user) {
    return (
      <AuthenticatedApp
        key={auth.user.id}
        user={auth.user}
        onSignedOut={() => dispatch({ type: 'signed-out' })}
      />
    );
  }

  const shared = {
    email,
    password,
    onEmailChange: setEmail,
    onPasswordChange: setPassword,
    onSubmit: () => void submit(),
    loading: auth.status === 'submitting',
    disabled: auth.status === 'submitting',
    errorMessage: auth.error ?? undefined,
  };

  return (
    <div className="pudle-shell">
      <header className="pudle-shell__header">
        <a className="pudle-wordmark" href="#pudle-main" aria-label="Pudle home"><span aria-hidden="true">p</span>Pudle</a>
        <PudleStatusBadge tone="accent">Private by default</PudleStatusBadge>
      </header>
      <main className="pudle-shell__main pudle-auth-main" id="pudle-main">
      <div className="pudle-auth-intro">
        <p className="pudle-eyebrow">Meet Pudy</p>
        <h1>Road context, without giving up your camera roll.</h1>
        <p>Sign in to unlock account-isolated recordings, local scene tools, and honest nearby road status.</p>
      </div>
      {mode === 'signin' ? (
        <PudleSignInPanel {...shared} />
      ) : (
        <PudleCreateAccountPanel
          {...shared}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
        />
      )}
      <div className="pudle-auth-switch">
        <span>{mode === 'signin' ? 'New to Pudle?' : 'Already have an account?'}</span>
        <PudleButton variant="quiet" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); dispatch({ type: 'session-resolved', user: null }); }}>
          {mode === 'signin' ? 'Create account' : 'Sign in instead'}
        </PudleButton>
      </div>
      </main>
    </div>
  );
}
