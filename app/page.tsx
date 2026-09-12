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
  PudleEmptyState,
  PudlePrivacyNotice,
  PudleProfilePanel,
  PudleShell,
  PudleSignInPanel,
  PudleStatusBadge,
  type PudleSection,
} from '@/components/pudle';
import {
  AppRecording,
  PudyAssistant,
  type AppRecordingHandle,
  type PudyAssistantHandle,
} from '@/components/app';
import { RecordingAccountSession } from '@/lib/client/recording';
import {
  authApi,
  authReducer,
  disposeLocalSession,
  initialAuthState,
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
  const [activeSection, setActiveSection] = useState<PudleSection>('drive');
  const [network, setNetwork] = useState<NetworkState>(
    typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline',
  );
  const [sceneLabels, setSceneLabels] = useState<string[]>([]);
  const [analysisLabels, setAnalysisLabels] = useState<string[]>([]);
  const [recordingActive, setRecordingActive] = useState(false);
  const [reportPrepared, setReportPrepared] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [assistantEnabled, setAssistantEnabled] = useState(true);

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
      return 'Hazard report prepared. Reporting stays disabled until you review it in the Ride integration.';
    }
    if (!recordingRef.current?.isRecording()) {
      return 'No recording is active. Start one from the camera controls first.';
    }
    await recordingRef.current.stopAndSave();
    return 'The current recording was stopped and saved on this device.';
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
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
        setReportPrepared(false);
      },
    });
    try {
      await authApi.signOut();
      onSignedOut();
    } catch (error) {
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
          <PudyAssistant
            ref={pudyRef}
            enabled={assistantEnabled}
            sceneLabels={sceneLabels}
            analysisLabels={analysisLabels}
            nearbyLabels={[]}
            onAction={handlePudyAction}
          />

          {reportPrepared ? (
            <section className="pudle-card pudle-confirm" aria-label="Prepared hazard report">
              <strong>Hazard report prepared, not shared.</strong>
              <p>Review and confirmation will be provided by the incoming AppRide integration.</p>
              <PudleButton variant="quiet" onClick={() => setReportPrepared(false)}>Cancel report</PudleButton>
            </section>
          ) : null}
        </>
      ) : null}

      {activeSection === 'ride' ? (
        <section className="pudle-card" data-app-ride-slot>
          <p className="pudle-eyebrow">AppRide integration slot</p>
          <h1>Ride</h1>
          <PudleEmptyState
            title="Ride integration pending"
            description="The coordinated AppRide component will provide nearby events, confirmed reports, groups, and messages here."
          />
        </section>
      ) : null}

      {activeSection === 'profile' ? (
        <PudleProfilePanel
          displayName={user.displayName}
          email={user.email}
          signingOut={signingOut}
          onSignOut={() => void signOut()}
          preferences={[
            {
              id: 'local-media',
              label: 'Local-only media',
              description: 'Required. Camera frames and recordings are never uploaded.',
              checked: true,
              disabled: true,
              onChange: () => undefined,
            },
            {
              id: 'pudy',
              label: 'Pudy foreground voice',
              description: 'Browser vendor cloud processing may occur only after Listen is tapped.',
              checked: assistantEnabled,
              onChange: setAssistantEnabled,
            },
            {
              id: 'cloud',
              label: 'Cloud analysis',
              description: 'Managed separately in Drive with explicit frame-analysis consent.',
              checked: false,
              disabled: true,
              onChange: () => undefined,
            },
          ]}
          accountActions={
            <>
              <PudlePrivacyNotice title="Account-scoped local storage">
                This browser keeps a separate recording account session for the stable server identity {user.id.slice(0, 8)}….
              </PudlePrivacyNotice>
            </>
          }
        />
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
