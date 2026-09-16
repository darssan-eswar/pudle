'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  createReplayInput,
  type RecordingAccountSession,
  type RecordingEvent,
  type ReplayInput,
  type StopRecordingResult,
  useRecordingController,
} from '@/lib/client/recording';
import { RecordingsLibrary } from '@/components/recording';
import {
  captureCompressedFrame,
  cloudAnalysisClient,
  CloudFrameController,
  recordingsApi,
  type CloudAnalysisState,
} from '@/lib/client/app';
import {
  createCocoSsdAdapter,
  captureSmolVlmFrame,
  LOCAL_INFERENCE_MIN_INTERVAL_MS,
  LocalInferenceScheduler,
  SMOLVLM_MODEL,
  SMOLVLM_REVISION,
  SmolVlmController,
  type LocalInferenceState,
  type SmolVlmState,
} from '@/lib/client/inference';
import {
  PudleButton,
  PudlePrivacyNotice,
  PudleStatusBadge,
} from '@/components/pudle';

export interface AppRecordingHandle {
  stopMedia(): void;
  revokeUrls(): void;
  dispose(): void;
  stopAndSave(): Promise<StopRecordingResult>;
  isRecording(): boolean;
}

export interface AppRecordingProps {
  account: RecordingAccountSession;
  activeSection: 'drive' | 'recordings' | 'ride' | 'profile';
  online: boolean;
  onSceneChange: (labels: string[]) => void;
  onCloudAnalysisChange: (labels: string[]) => void;
  onRecordingStateChange: (active: boolean) => void;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function cloudLabel(cloud: CloudAnalysisState): string {
  switch (cloud.status) {
    case 'unconfigured': return 'Unconfigured';
    case 'available': return 'Available · off';
    case 'processing': return 'Processing';
    case 'ready': return 'Current result';
    case 'timeout': return 'Timed out';
    case 'quota': return 'Quota reached';
    case 'malformed': return 'Unreadable response';
    case 'failure': return cloud.retryable ? 'Retryable failure' : 'Unavailable';
    case 'stale': return 'Stale result discarded';
  }
}

function cloudTone(
  cloud: CloudAnalysisState,
): 'positive' | 'accent' | 'warning' | 'danger' {
  if (cloud.status === 'ready') return 'positive';
  if (cloud.status === 'available') return 'positive';
  if (cloud.status === 'processing') return 'accent';
  if (cloud.status === 'unconfigured') return 'warning';
  return 'danger';
}

function localInferenceLabel(inference: LocalInferenceState): string {
  switch (inference.status) {
    case 'capability':
      return inference.capability.supported ? 'Not loaded' : 'Unsupported';
    case 'loading':
      return 'Loading';
    case 'ready':
      return 'Ready locally';
    case 'error':
      return 'Unavailable';
  }
}

function smolVlmLabel(state: SmolVlmState): string {
  switch (state.status) {
    case 'checking': return 'Checking WebGPU';
    case 'unsupported': return 'Unsupported';
    case 'idle': return 'Not loaded';
    case 'loading': return `${Math.round(state.progress)}% downloaded`;
    case 'ready': return state.result ? 'Description ready' : 'Ready locally';
    case 'describing': return 'Describing frame';
    case 'error': return 'Unavailable';
  }
}

function formatBytes(value?: number): string | null {
  if (value === undefined) return null;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export const AppRecording = forwardRef<AppRecordingHandle, AppRecordingProps>(
  function AppRecording(
    { account, activeSection, online, onSceneChange, onCloudAnalysisChange, onRecordingStateChange },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const replayVideoRef = useRef<HTMLVideoElement>(null);
    const replayRef = useRef<ReplayInput | undefined>(undefined);
    const [libraryRevision, setLibraryRevision] = useState(0);
    const [replay, setReplay] = useState<ReplayInput>();
    const [replayError, setReplayError] = useState('');
    const serverMetadataIds = useRef(new Map<string, string>());
    const [metadataStatus, setMetadataStatus] = useState<'loading' | 'synced' | 'error'>('loading');
    const sceneChangeRef = useRef(onSceneChange);
    sceneChangeRef.current = onSceneChange;
    const [inference, setInference] = useState<LocalInferenceState>(() => ({
      status: 'capability',
      capability: { supported: true },
    }));
    const [pageVisible, setPageVisible] = useState(true);
    const [localRunner] = useState(
      () =>
        new LocalInferenceScheduler(createCocoSsdAdapter(), {
          onState: setInference,
          onResult: (result) => {
            sceneChangeRef.current(
              result.observations.map((observation) => observation.label),
            );
          },
        }),
    );
    const [smolVlm, setSmolVlm] = useState<SmolVlmState>({ status: 'checking' });
    const [smolVlmConsent, setSmolVlmConsent] = useState(false);
    const [smolVlmFrameError, setSmolVlmFrameError] = useState('');
    const [smolVlmRunner] = useState(
      () => new SmolVlmController({ onState: setSmolVlm }),
    );
    const [cloud, setCloud] = useState<CloudAnalysisState>(
      cloudAnalysisClient.unconfigured,
    );
    const [cloudConsent, setCloudConsent] = useState(false);
    const [cloudEnabled, setCloudEnabled] = useState(false);
    const captureStartedAt = useRef(Date.now());
    const cloudTaskRef = useRef<
      (signal: AbortSignal, capturedAt: number) => Promise<void>
    >(async () => undefined);
    const [cloudRunner] = useState(
      () => new CloudFrameController(
        (signal, capturedAt) => cloudTaskRef.current(signal, capturedAt),
      ),
    );

    useEffect(() => {
      let active = true;
      void cloudAnalysisClient.status().then((status) => {
        if (active) setCloud(status);
      });
      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      return () => smolVlmRunner.dispose();
    }, [smolVlmRunner]);

    useEffect(() => {
      let active = true;
      void recordingsApi.list()
        .then(({ recordings }) => {
          if (!active) return;
          serverMetadataIds.current = new Map(
            recordings.map((item) => [item.clientRecordingId, item.id]),
          );
          setMetadataStatus('synced');
        })
        .catch(() => {
          if (active) setMetadataStatus('error');
        });
      return () => {
        active = false;
      };
    }, [account.ownerId]);

    const handleRecordingEvent = useCallback(
      (event: RecordingEvent) => {
        if (event.type === 'recording-saved' || event.type === 'recording-deleted') {
          setLibraryRevision((revision) => revision + 1);
        }
        if (event.type === 'recording-saved') {
          const metadata = event.metadata;
          void recordingsApi.create({
            clientRecordingId: metadata.id,
            durationMs: metadata.durationMs,
            mimeType: metadata.mimeType.includes('mp4') ? 'video/mp4' : 'video/webm',
            byteLength: metadata.size,
            capturedAt: metadata.createdAt,
          }).then(({ recording }) => {
            serverMetadataIds.current.set(metadata.id, recording.id);
            setMetadataStatus('synced');
          }).catch(() => setMetadataStatus('error'));
        }
        if (event.type === 'recording-deleted') {
          void (async () => {
            let serverId = serverMetadataIds.current.get(event.id);
            if (!serverId) {
              const { recordings } = await recordingsApi.list();
              serverId = recordings.find(
                (item) => item.clientRecordingId === event.id,
              )?.id;
            }
            if (serverId) await recordingsApi.delete(serverId);
            serverMetadataIds.current.delete(event.id);
            setMetadataStatus('synced');
          })().catch(() => setMetadataStatus('error'));
        }
      },
      [],
    );

    const controller = useRecordingController({
      account,
      onEvent: handleRecordingEvent,
    });
    const recordingActive =
      controller.state === 'recording' || controller.state === 'paused';

    cloudTaskRef.current = async (signal) => {
      try {
        const source = controller.stream ? videoRef.current : replayVideoRef.current;
        if (!source) throw new Error('Start the camera or select a replay first.');
        const frame = await captureCompressedFrame(source);
        const requestId = crypto.randomUUID();
        onCloudAnalysisChange([]);
        setCloud({
          status: 'processing',
          result: null,
          analysisId: requestId,
          startedAt: frame.capturedAt,
        });
        const response = await cloudAnalysisClient.submitFrame(frame.blob, {
          capturedAt: frame.capturedAt,
          idempotencyKey: requestId,
          signal,
        });
        if (signal.aborted || response.result.capturedAt < captureStartedAt.current) return;
        setCloud({
          status: 'ready',
          result: response.result,
          analysisId: response.jobId,
        });
        onCloudAnalysisChange([
          response.result.summary,
          ...response.result.observations,
        ]);
      } catch (caught) {
        if (signal.aborted) return;
        onCloudAnalysisChange([]);
        const error = caught as Error & { code?: string };
        if (error.code === 'provider_unconfigured') {
          setCloud({ status: 'unconfigured', result: null, message: error.message });
        } else if (error.code === 'provider_timeout') {
          setCloud({ status: 'timeout', result: null, retryable: true, message: error.message });
        } else if (error.code === 'provider_quota') {
          setCloud({ status: 'quota', result: null, retryable: true, message: error.message });
        } else if (error.code === 'malformed_provider_response') {
          setCloud({ status: 'malformed', result: null, retryable: true, message: error.message });
        } else {
          setCloud({ status: 'failure', result: null, retryable: true, message: error.message });
        }
      }
    };

    useEffect(() => {
      onRecordingStateChange(recordingActive);
    }, [onRecordingStateChange, recordingActive]);

    useEffect(() => {
      if (videoRef.current) videoRef.current.srcObject = controller.stream ?? null;
      captureStartedAt.current = Date.now();
      if (cloudEnabled) {
        queueMicrotask(() => {
          onCloudAnalysisChange([]);
          setCloud({
            status: 'processing',
            result: null,
            analysisId: crypto.randomUUID(),
            startedAt: captureStartedAt.current,
          });
        });
      }
    }, [cloudEnabled, controller.stream, onCloudAnalysisChange]);

    useEffect(() => {
      if (!cloudEnabled || !online || (!controller.stream && !replay)) {
        cloudRunner.disable();
        if (cloudEnabled && !online) {
          queueMicrotask(() => {
            onCloudAnalysisChange([]);
            setCloud({
              status: 'failure',
              result: null,
              retryable: true,
              message: 'Cloud analysis is paused while offline.',
            });
          });
        } else if (cloudEnabled && !controller.stream && !replay) {
          queueMicrotask(() => {
            onCloudAnalysisChange([]);
            setCloud({
              status: 'failure',
              result: null,
              retryable: true,
              message: 'Cloud analysis is waiting for a camera or selected replay.',
            });
          });
        }
        return;
      }
      captureStartedAt.current = Date.now();
      cloudRunner.enable();
      void cloudRunner.tick();
      const timer = window.setInterval(() => void cloudRunner.tick(), 5_000);
      return () => {
        window.clearInterval(timer);
        cloudRunner.disable();
      };
    }, [cloudEnabled, cloudRunner, controller.stream, online, onCloudAnalysisChange, replay]);

    useEffect(() => () => cloudRunner.disable(), [cloudRunner]);

    const stopDetection = useCallback(() => {
      localRunner.stop();
      sceneChangeRef.current([]);
    }, [localRunner]);

    useEffect(() => {
      const onVisibilityChange = () => {
        const visible = document.visibilityState !== 'hidden';
        if (!visible) {
          stopDetection();
          smolVlmRunner.unload('Model unloaded when Pudle was hidden.');
          setSmolVlmConsent(false);
          setSmolVlmFrameError('');
        } else if (smolVlmRunner.state.status === 'checking') {
          void smolVlmRunner.checkCapability();
        }
        setPageVisible(visible);
      };
      queueMicrotask(onVisibilityChange);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [smolVlmRunner, stopDetection]);

    useEffect(() => {
      if (activeSection === 'drive') return;
      smolVlmRunner.unload('Model unloaded after leaving Drive.');
      setSmolVlmConsent(false);
      setSmolVlmFrameError('');
    }, [activeSection, smolVlmRunner]);

    useEffect(() => {
      if (!controller.stream || !pageVisible || activeSection !== 'drive') {
        stopDetection();
        return;
      }
      let cancelled = false;
      let timer: number | undefined;
      void localRunner.start().then((ready) => {
        if (!ready || cancelled) return;
        const tick = () => {
          const video = videoRef.current;
          if (
            !video
            || video.readyState < 2
            || !video.videoWidth
            || !video.videoHeight
          ) return;
          void localRunner.run(video, Date.now());
        };
        tick();
        timer = window.setInterval(tick, LOCAL_INFERENCE_MIN_INTERVAL_MS);
      });
      return () => {
        cancelled = true;
        if (timer !== undefined) window.clearInterval(timer);
        stopDetection();
      };
    }, [activeSection, controller.stream, localRunner, pageVisible, stopDetection]);

    const revokeTrackedUrls = useCallback(() => {
      replayRef.current?.revoke();
      replayRef.current = undefined;
    }, []);

    const revokeUrls = useCallback(() => {
      revokeTrackedUrls();
      setReplay(undefined);
    }, [revokeTrackedUrls]);

    useEffect(
      () => () => {
        revokeTrackedUrls();
      },
      [revokeTrackedUrls],
    );

    useImperativeHandle(
      ref,
      () => ({
        stopMedia() {
          stopDetection();
          smolVlmRunner.unload();
          setSmolVlmConsent(false);
          controller.releaseCamera();
        },
        revokeUrls,
        dispose() {
          setCloudEnabled(false);
          onCloudAnalysisChange([]);
          cloudRunner.disable();
          stopDetection();
          smolVlmRunner.dispose();
          setSmolVlmConsent(false);
          controller.dispose();
        },
        stopAndSave: controller.stop,
        isRecording: () => recordingActive,
      }),
      [
        cloudRunner,
        controller,
        onCloudAnalysisChange,
        recordingActive,
        revokeUrls,
        smolVlmRunner,
        stopDetection,
      ],
    );

    const describeCurrentFrame = useCallback(() => {
      setSmolVlmFrameError('');
      const video = videoRef.current;
      if (!video) {
        setSmolVlmFrameError('Start the camera before describing a frame.');
        return;
      }
      try {
        const frame = captureSmolVlmFrame(video);
        if (!smolVlmRunner.describe(frame)) {
          setSmolVlmFrameError('Wait for the local model to become ready.');
        }
      } catch (error) {
        setSmolVlmFrameError(
          error instanceof Error ? error.message : 'The current frame could not be captured.',
        );
      }
    }, [smolVlmRunner]);

    function selectReplay(file?: File) {
      replayRef.current?.revoke();
      replayRef.current = undefined;
      setReplay(undefined);
      if (!file) return;
      try {
        const nextReplay = createReplayInput(file, {
          urlApi: {
            createObjectURL: (blob) => {
              if (!(blob instanceof Blob)) {
                throw new Error('Only local video files can be replayed.');
              }
              return account.createObjectUrl(blob);
            },
            revokeObjectURL: (url) => account.revokeObjectUrl(url),
          },
        });
        replayRef.current = nextReplay;
        setReplay(nextReplay);
        setReplayError('');
      } catch (error) {
        setReplayError(error instanceof Error ? error.message : 'Replay file is unavailable.');
      }
    }

    return (
      <>
        <div hidden={activeSection !== 'drive'} className="pudle-drive">
          <section className="pudle-camera" aria-labelledby="camera-title">
            <div className="pudle-camera__viewport">
              <video
                ref={videoRef}
                className="pudle-live-video"
                autoPlay
                muted
                playsInline
                aria-label="Private rear camera preview"
              />
              {!controller.stream ? (
                <div className="pudle-camera-rationale">
                  <span className="pudle-camera-rationale__icon" aria-hidden="true">◉</span>
                  <h1 id="camera-title">Your private road view</h1>
                  <p>
                    Camera access begins only after you tap below. Live frames stay on this device
                    unless you separately consent to periodic compressed-frame cloud analysis.
                  </p>
                </div>
              ) : null}
              <div className="pudle-camera__status">
                <PudleStatusBadge tone={recordingActive ? 'danger' : controller.stream ? 'positive' : 'neutral'}>
                  {recordingActive
                    ? `Recording ${formatElapsed(controller.elapsedMs)}`
                    : controller.state === 'acquiring'
                      ? 'Waiting for camera permission'
                      : controller.state === 'interrupted'
                        ? 'Camera interrupted'
                        : controller.stream
                          ? 'Camera on · local only'
                          : 'Camera off'}
                </PudleStatusBadge>
              </div>
            </div>
            {controller.error ? <p className="pudle-inline-error" role="alert">{controller.error.message}</p> : null}
            <div className="pudle-drive-controls" aria-label="Camera and recording controls">
              {!controller.stream ? (
                <PudleButton loading={controller.state === 'acquiring'} onClick={() => void controller.acquireCamera()}>
                  Enable camera
                </PudleButton>
              ) : null}
              {controller.stream && !recordingActive ? (
                <PudleButton onClick={controller.start}>Start recording</PudleButton>
              ) : null}
              {controller.state === 'recording' ? (
                <PudleButton variant="secondary" onClick={controller.pause}>Pause</PudleButton>
              ) : null}
              {controller.state === 'paused' ? (
                <PudleButton variant="secondary" onClick={controller.resume}>Resume</PudleButton>
              ) : null}
              {recordingActive ? (
                <PudleButton variant="danger" onClick={() => void controller.stop()}>Stop &amp; save</PudleButton>
              ) : null}
              {controller.stream && !recordingActive ? (
                <PudleButton variant="quiet" onClick={() => { stopDetection(); controller.releaseCamera(); }}>
                  Camera off
                </PudleButton>
              ) : null}
            </div>
          </section>

          <aside className="pudle-safety">
            <strong>Set up while parked.</strong>
            <span>Keep the phone mounted and controls out of your driving path.</span>
          </aside>

          <section className="pudle-card pudle-cloud">
            <div className="pudle-panel-header">
              <div><p className="pudle-eyebrow">Independent from camera</p><h2>Cloud analysis</h2></div>
              <PudleStatusBadge tone={cloudTone(cloud)}>
                {cloudLabel(cloud)}
              </PudleStatusBadge>
            </div>
            <p>
              {cloud.status === 'unconfigured'
                ? `${cloud.message} If configured later, only explicitly consented periodic compressed frames would be sent to the disclosed provider subject to its retention policy.`
                : cloud.status === 'available'
                  ? `${cloud.provider} / ${cloud.model} is available. Cloud analysis stays off until you consent and enable periodic compressed-frame uploads.`
                : cloud.status === 'ready'
                  ? cloud.result.summary
                  : 'message' in cloud
                    ? cloud.message
                    : 'Cloud analysis is processing. Camera and local recording remain independent.'}
            </p>
            {cloud.status === 'ready' ? (
              <div className="pudle-analysis-result" aria-live="polite">
                <strong>{cloud.result.summary}</strong>
                <span>
                  {typeof cloud.result.confidence === 'number'
                    ? `${Math.round(cloud.result.confidence * 100)}% confidence`
                    : 'Confidence unavailable'}
                  {' · '}
                  {cloud.result.source ?? 'cloud-ai'}
                  {cloud.result.model ? ` · ${cloud.result.model}` : ''}
                </span>
                {cloud.result.uncertainty ? <small>{cloud.result.uncertainty}</small> : null}
                <time dateTime={new Date(cloud.result.capturedAt).toISOString()}>
                  Frame captured {new Date(cloud.result.capturedAt).toLocaleTimeString()}
                  {cloud.result.analyzedAt
                    ? ` · result ${new Date(cloud.result.analyzedAt).toLocaleTimeString()}`
                    : ''}
                </time>
              </div>
            ) : null}
            <label className="pudle-consent">
              <input
                type="checkbox"
                checked={cloudConsent}
                disabled={cloudEnabled}
                onChange={(event) => setCloudConsent(event.target.checked)}
              />
              <span>
                I consent to sending exactly periodic compressed frames to Google’s configured model.
                Pudle retains frames for zero time, but Google’s terms and provider retention may apply
                and cannot be guaranteed by Pudle. Recordings and audio are never uploaded.
              </span>
            </label>
            <PudleButton
              variant={cloudEnabled ? 'danger' : 'secondary'}
              disabled={
                !cloudEnabled &&
                (!cloudConsent ||
                !online ||
                  !['available', 'ready', 'failure', 'timeout', 'quota', 'malformed'].includes(cloud.status) ||
                  (!controller.stream && !replay))
              }
              onClick={() => {
                if (cloudEnabled) {
                  cloudRunner.disable();
                  setCloudEnabled(false);
                  onCloudAnalysisChange([]);
                  void cloudAnalysisClient.status().then(setCloud);
                } else {
                  setCloudEnabled(true);
                }
              }}
            >
              {cloudEnabled ? 'Disable cloud analysis' : 'Enable cloud analysis'}
            </PudleButton>
          </section>

          <section className="pudle-card">
            <div className="pudle-panel-header">
              <div><p className="pudle-eyebrow">Optional · downloaded after camera starts</p><h2>Local scene detection</h2></div>
              <PudleStatusBadge tone={inference.status === 'ready' ? 'positive' : inference.status === 'error' ? 'warning' : 'neutral'}>
                {localInferenceLabel(inference)}
              </PudleStatusBadge>
            </div>
            <p className="pudle-muted">
              {inference.status === 'error'
                ? inference.message
                : 'Camera and manual reporting remain available if the optional model cannot load.'}
            </p>
            {inference.status === 'ready' ? (
              <p className="pudle-disclosure">
                {inference.source} · {inference.model}
                {inference.result
                  ? ` · last frame ${new Date(inference.result.capturedAt).toLocaleTimeString()} · ${Math.round(inference.result.latencyMs)} ms`
                  : ' · waiting for a current frame'}
              </p>
            ) : null}
          </section>

          <section className="pudle-card" aria-labelledby="smolvlm-title">
            <div className="pudle-panel-header">
              <div>
                <p className="pudle-eyebrow">Experimental · manual · on device</p>
                <h2 id="smolvlm-title">Describe one frame</h2>
              </div>
              <PudleStatusBadge
                tone={
                  smolVlm.status === 'ready'
                    ? 'positive'
                    : smolVlm.status === 'describing' || smolVlm.status === 'loading'
                      ? 'accent'
                      : smolVlm.status === 'error'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {smolVlmLabel(smolVlm)}
              </PudleStatusBadge>
            </div>
            <p className="pudle-muted">
              SmolVLM can describe a single frame only when you tap Describe frame.
              Pixels stay in this browser worker and are discarded after the request.
              Descriptions may be wrong and never create reports or actions.
            </p>
            {smolVlm.status === 'loading' ? (
              <div className="pudle-model-progress" role="status" aria-live="polite">
                <progress max="100" value={smolVlm.progress}>
                  {Math.round(smolVlm.progress)}%
                </progress>
                <small>
                  {formatBytes(smolVlm.downloadedBytes)}
                  {smolVlm.totalBytes
                    ? ` of ${formatBytes(smolVlm.totalBytes)} discovered files`
                    : 'Preparing model files'}
                  {smolVlm.file ? ` · ${smolVlm.file}` : ''}
                </small>
              </div>
            ) : null}
            {smolVlm.status === 'unsupported'
              || smolVlm.status === 'error'
              || (smolVlm.status === 'idle' && smolVlm.message) ? (
                <p className="pudle-inline-error" role="status">
                  {smolVlm.status === 'idle' ? smolVlm.message : smolVlm.message}
                </p>
              ) : null}
            {smolVlm.status === 'ready' && smolVlm.result ? (
              <div className="pudle-analysis-result" aria-live="polite">
                <strong>{smolVlm.result.description}</strong>
                <span>
                  {smolVlm.result.source} · {smolVlm.result.model} ·{' '}
                  {Math.round(smolVlm.result.latencyMs)} ms
                </span>
                <time dateTime={new Date(smolVlm.result.capturedAt).toISOString()}>
                  Frame captured {new Date(smolVlm.result.capturedAt).toLocaleTimeString()}
                  {' · '}
                  result {new Date(smolVlm.result.analyzedAt).toLocaleTimeString()}
                </time>
              </div>
            ) : null}
            {smolVlm.status === 'idle' || smolVlm.status === 'error' ? (
              <label className="pudle-consent">
                <input
                  type="checkbox"
                  checked={smolVlmConsent}
                  onChange={(event) => setSmolVlmConsent(event.target.checked)}
                />
                <span>
                  Download approximately 260 MB of pinned model weights plus runtime files
                  from Hugging Face. The browser may cache model files. No camera frame is
                  uploaded or persisted by Pudle.
                </span>
              </label>
            ) : null}
            <div className="pudle-drive-controls" aria-label="Local description controls">
              {smolVlm.status === 'idle' || smolVlm.status === 'error' ? (
                <PudleButton
                  variant="secondary"
                  disabled={!smolVlmConsent}
                  onClick={() => void smolVlmRunner.load(smolVlmConsent)}
                >
                  Download local model
                </PudleButton>
              ) : null}
              {smolVlm.status === 'ready' ? (
                <PudleButton
                  disabled={!controller.stream}
                  onClick={describeCurrentFrame}
                >
                  Describe frame
                </PudleButton>
              ) : null}
              {['loading', 'ready', 'describing'].includes(smolVlm.status) ? (
                <PudleButton
                  variant="danger"
                  onClick={() => {
                    smolVlmRunner.unload('Local model stopped and unloaded.');
                    setSmolVlmConsent(false);
                    setSmolVlmFrameError('');
                  }}
                >
                  Stop &amp; unload
                </PudleButton>
              ) : null}
            </div>
            {smolVlmFrameError ? (
              <p className="pudle-inline-error" role="alert">{smolVlmFrameError}</p>
            ) : null}
            <p className="pudle-disclosure">
              {SMOLVLM_MODEL} · revision {SMOLVLM_REVISION.slice(0, 12)} · Apache-2.0 ·
              WebGPU and shader-f16 required · maximum 512 px frame / 64 new tokens
            </p>
          </section>
        </div>

        <section hidden={activeSection !== 'recordings'} className="pudle-section" aria-labelledby="recordings-title">
          <p className="pudle-eyebrow">Private device library</p>
          <h1 id="recordings-title">Recordings</h1>
          <PudlePrivacyNotice>Videos remain in this browser until you export or delete them.</PudlePrivacyNotice>
          <p className="pudle-muted" role="status">
            {metadataStatus === 'loading'
              ? 'Checking private metadata…'
              : metadataStatus === 'synced'
                ? 'Recording details are synced to your account; media remains only on this device.'
                : 'Metadata sync is unavailable. Local media remains available and private.'}
          </p>
          <label className="pudle-file-picker">
            <span>Replay a video you choose</span>
            <input type="file" accept="video/*" onChange={(event) => selectReplay(event.target.files?.[0])} />
          </label>
          {replay ? <video ref={replayVideoRef} className="pudle-player" controls playsInline src={replay.url} aria-label={`Replay ${replay.file.name}`} /> : null}
          {replayError ? <p className="pudle-inline-error" role="alert">{replayError}</p> : null}
          <RecordingsLibrary
            key={`${account.ownerId}-${libraryRevision}`}
            account={account}
            onEvent={handleRecordingEvent}
          />
        </section>
      </>
    );
  },
);
