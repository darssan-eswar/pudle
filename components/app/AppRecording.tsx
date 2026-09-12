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
  PudleButton,
  PudlePrivacyNotice,
  PudleStatusBadge,
} from '@/components/pudle';

type Detector = {
  detect(video: HTMLVideoElement): Promise<Array<{ class: string; score: number }>>;
};

export interface AppRecordingHandle {
  stopMedia(): void;
  revokeUrls(): void;
  dispose(): void;
  stopAndSave(): Promise<void>;
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

export const AppRecording = forwardRef<AppRecordingHandle, AppRecordingProps>(
  function AppRecording(
    { account, activeSection, online, onSceneChange, onCloudAnalysisChange, onRecordingStateChange },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const replayVideoRef = useRef<HTMLVideoElement>(null);
    const detectorRef = useRef<Detector | undefined>(undefined);
    const detectionTimer = useRef<number | undefined>(undefined);
    const replayRef = useRef<ReplayInput | undefined>(undefined);
    const [libraryRevision, setLibraryRevision] = useState(0);
    const [replay, setReplay] = useState<ReplayInput>();
    const [replayError, setReplayError] = useState('');
    const serverMetadataIds = useRef(new Map<string, string>());
    const [metadataStatus, setMetadataStatus] = useState<'loading' | 'synced' | 'error'>('loading');
    const [inference, setInference] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
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
      if (detectionTimer.current !== undefined) {
        window.clearInterval(detectionTimer.current);
        detectionTimer.current = undefined;
      }
      detectorRef.current = undefined;
      onSceneChange([]);
      setInference('idle');
    }, [onSceneChange]);

    useEffect(() => {
      if (!controller.stream) return;
      let cancelled = false;
      setInference('loading');
      void Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ])
        .then(async ([tf, coco]) => {
          await tf.ready();
          const detector = await coco.load({ base: 'lite_mobilenet_v2' });
          if (cancelled) return;
          detectorRef.current = detector;
          setInference('ready');
          detectionTimer.current = window.setInterval(() => {
            const video = videoRef.current;
            if (!video || video.readyState < 2 || !detectorRef.current) return;
            void detectorRef.current.detect(video).then((items) => {
              if (!cancelled) {
                onSceneChange(
                  items
                    .filter((item) => item.score >= 0.6)
                    .slice(0, 4)
                    .map((item) => item.class),
                );
              }
            }).catch(() => {
              if (!cancelled) setInference('unavailable');
            });
          }, 1500);
        })
        .catch(() => {
          if (!cancelled) setInference('unavailable');
        });
      return () => {
        cancelled = true;
        stopDetection();
      };
    }, [controller.stream, onSceneChange, stopDetection]);

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
          controller.releaseCamera();
        },
        revokeUrls,
        dispose() {
          setCloudEnabled(false);
          onCloudAnalysisChange([]);
          cloudRunner.disable();
          stopDetection();
          controller.dispose();
        },
        stopAndSave: controller.stop,
        isRecording: () => recordingActive,
      }),
      [cloudRunner, controller, onCloudAnalysisChange, recordingActive, revokeUrls, stopDetection],
    );

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
                  <p>Camera access begins only after you tap below. Frames stay on this device.</p>
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
                ? `${cloud.message} If enabled in the future, compressed frames would be sent to a disclosed provider subject to its retention policy.`
                : cloud.status === 'available'
                  ? `${cloud.provider} / ${cloud.model} is available, but this app does not sample or upload frames.`
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
              <PudleStatusBadge tone={inference === 'ready' ? 'positive' : inference === 'unavailable' ? 'warning' : 'neutral'}>
                {inference === 'loading' ? 'Loading' : inference === 'ready' ? 'Ready locally' : inference === 'unavailable' ? 'Unavailable' : 'Not loaded'}
              </PudleStatusBadge>
            </div>
            <p className="pudle-muted">Camera and manual reporting remain available if the optional model cannot load.</p>
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
