'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type AlertKind = 'debris' | 'flooding' | 'crash' | 'stalled' | 'unpredictable';

type MockAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  distance: string;
  freshness: string;
  confirmations: number;
  confidence: 'High' | 'Medium';
  tone: 'caution' | 'urgent';
};

type Prediction = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
};

type Detector = {
  detect: (input: HTMLVideoElement) => Promise<Prediction[]>;
};

type PermissionState = 'rationale' | 'requesting' | 'granted' | 'denied' | 'unavailable';
type ModelState = 'idle' | 'loading' | 'ready' | 'unavailable';
type NetworkState = 'online' | 'offline' | 'reconnecting';

const mockAlerts: MockAlert[] = [
  { id: 'debris-1', kind: 'debris', title: 'Debris in right lane', distance: '0.3 mi', freshness: '2 min', confirmations: 4, confidence: 'High', tone: 'caution' },
  { id: 'flooding-1', kind: 'flooding', title: 'Standing water', distance: '0.8 mi', freshness: '4 min', confirmations: 3, confidence: 'High', tone: 'caution' },
  { id: 'crash-1', kind: 'crash', title: 'Crash ahead', distance: '1.2 mi', freshness: '6 min', confirmations: 6, confidence: 'High', tone: 'urgent' },
  { id: 'stalled-1', kind: 'stalled', title: 'Stalled vehicle', distance: '1.5 mi', freshness: '8 min', confirmations: 2, confidence: 'Medium', tone: 'caution' },
  { id: 'unpredictable-1', kind: 'unpredictable', title: 'Unpredictable vehicle movement', distance: '1.9 mi', freshness: '3 min', confirmations: 2, confidence: 'Medium', tone: 'urgent' },
];

const reportOptions: Array<{ kind: AlertKind; label: string; icon: string }> = [
  { kind: 'debris', label: 'Debris', icon: '!' },
  { kind: 'flooding', label: 'Flooding', icon: '≈' },
  { kind: 'crash', label: 'Crash', icon: '×' },
  { kind: 'stalled', label: 'Stalled vehicle', icon: '■' },
];

const assistantAnswers: Record<string, string> = {
  ahead: 'Debris is reported 0.3 miles ahead in the right lane. Slow down and stay alert.',
  route: 'Three confirmed hazards are within 1.2 miles. The nearest is debris in the right lane.',
  clear: 'No clear-route guarantee is available in demo mode. Keep watching the road and follow posted guidance.',
};

const detectableRoadObjects = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person', 'traffic light', 'stop sign']);

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 6.5 9.5 4.8h5L15.8 6.5H19a2 2 0 0 1 2 2v8.7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.2Z" />
      <circle cx="12" cy="12.8" r="3.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 20 6v5.8c0 4.8-3.2 8-8 9.4-4.8-1.4-8-4.6-8-9.4V6l8-3.2Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'chevron is-open' : 'chevron'} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const detectingRef = useRef(false);
  const scanGenerationRef = useRef(0);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const assistantButtonRef = useRef<HTMLButtonElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [cameraState, setCameraState] = useState<PermissionState>('rationale');
  const [locationState, setLocationState] = useState<PermissionState>('rationale');
  const [modelState, setModelState] = useState<ModelState>('idle');
  const [networkState, setNetworkState] = useState<NetworkState>('online');
  const [alertFeedOpen, setAlertFeedOpen] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showEmptyFeed, setShowEmptyFeed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Demo ready · camera stays off until you start');
  const [reportSuccess, setReportSuccess] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState(assistantAnswers.ahead);
  const [predictionCount, setPredictionCount] = useState(0);

  const stopCamera = useCallback(() => {
    scanGenerationRef.current += 1;
    if (detectionTimerRef.current !== null) window.clearInterval(detectionTimerRef.current);
    detectionTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    detectingRef.current = false;
    setPredictionCount(0);
    setModelState('idle');
    setIsScanning(false);
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    const goOffline = () => {
      setNetworkState('offline');
      setStatusMessage('Offline · camera and reports still work locally');
    };
    const goOnline = () => {
      setNetworkState('reconnecting');
      setStatusMessage('Connection restored · reconnecting');
      window.setTimeout(() => {
        setNetworkState('online');
        setStatusMessage(isScanning ? 'Local scan active · nothing uploaded' : 'Demo ready · camera stays off until you start');
      }, 1400);
    };
    if (!navigator.onLine) goOffline();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [isScanning]);

  const drawPredictions = useCallback((predictions: Prediction[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 4;
    context.font = '700 16px system-ui';
    predictions.forEach(({ bbox: [x, y, width, height], class: objectClass, score }) => {
      const label = `${objectClass.toUpperCase()} ${Math.round(score * 100)}%`;
      context.strokeStyle = '#d8ff4f';
      context.fillStyle = '#d8ff4f';
      context.strokeRect(x, y, width, height);
      context.fillRect(x, Math.max(0, y - 28), context.measureText(label).width + 16, 28);
      context.fillStyle = '#10150d';
      context.fillText(label, x + 8, Math.max(19, y - 8));
    });
  }, []);

  const loadLocalModel = useCallback(async (scanGeneration: number) => {
    setModelState('loading');
    try {
      const [tf, cocoSsd] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ]);
      await tf.ready();
      const detector = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      if (scanGeneration !== scanGenerationRef.current || !streamRef.current) return;
      detectorRef.current = detector;
      setModelState('ready');
      setStatusMessage('Local scan active · nothing uploaded');
      detectionTimerRef.current = window.setInterval(async () => {
        if (scanGeneration !== scanGenerationRef.current) return;
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (!video || !detector || detectingRef.current || video.readyState < 2) return;
        detectingRef.current = true;
        try {
          const predictions = (await detector.detect(video))
            .filter((prediction) => prediction.score >= 0.55 && detectableRoadObjects.has(prediction.class))
            .slice(0, 6);
          setPredictionCount(predictions.length);
          drawPredictions(predictions);
        } catch {
          if (scanGeneration !== scanGenerationRef.current) return;
          setModelState('unavailable');
        } finally {
          detectingRef.current = false;
        }
      }, 1000);
    } catch {
      setModelState('unavailable');
      setStatusMessage('Camera active · optional detection unavailable');
    }
  }, [drawPredictions]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      setStatusMessage('Camera is unavailable here · manual reports still work');
      return;
    }
    setCameraState('requesting');
    setStatusMessage('Waiting for camera permission');
    const scanGeneration = scanGenerationRef.current + 1;
    scanGenerationRef.current = scanGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('granted');
      setIsScanning(true);
      setStatusMessage('Camera active · downloading optional local detection');
      void loadLocalModel(scanGeneration);
    } catch {
      if (scanGeneration !== scanGenerationRef.current) return;
      setCameraState('denied');
      setStatusMessage('Camera blocked · allow it in browser settings, then retry');
    }
  }, [loadLocalModel]);

  const handleScan = useCallback(() => {
    if (isScanning) {
      stopCamera();
      setStatusMessage('Scan stopped · camera is off');
      return;
    }
    void startCamera();
  }, [isScanning, startCamera, stopCamera]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationState('unavailable');
      return;
    }
    setLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationState('granted');
        setStatusMessage('Location permission on · coordinates discarded in this mock');
      },
      () => setLocationState('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  const submitReport = (label: string) => {
    setReportSuccess(`${label} saved to this demo · no network request sent.`);
    setReportOpen(false);
    window.requestAnimationFrame(() => reportButtonRef.current?.focus());
    window.setTimeout(() => setReportSuccess(''), 4200);
  };

  const cameraLabel = cameraState === 'requesting'
    ? 'Waiting for permission'
    : cameraState === 'denied'
      ? 'Camera blocked'
      : cameraState === 'unavailable'
        ? 'Camera unavailable'
        : isScanning
          ? modelState === 'ready'
            ? `${predictionCount} road object${predictionCount === 1 ? '' : 's'} seen`
            : modelState === 'loading'
              ? 'Loading local detection'
              : 'Camera active'
          : 'Local camera preview';

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Pudle home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>Pudle</span>
        </a>
        <div className="privacy-meter" aria-label="Privacy is on. Video sent: zero kilobytes.">
          <ShieldIcon />
          <span><strong>Privacy On</strong><small>Video sent 0 KB</small></span>
        </div>
      </header>

      {networkState !== 'online' && (
        <div className={`network-banner ${networkState}`} role="status">
          <span className="network-dot" />
          {networkState === 'offline' ? 'Offline · local tools stay available' : 'Back online · reconnecting'}
        </div>
      )}

      <div className="dashboard" id="main-content">
        <section className="camera-card" aria-labelledby="camera-heading">
          <h1 className="sr-only" id="camera-heading">Pudle local road scanner</h1>
          <div className="camera-stage">
            <div className="demo-road" aria-hidden="true">
              <span className="road-line road-line-one" />
              <span className="road-line road-line-two" />
              <span className="road-line road-line-three" />
              <span className="demo-horizon" />
            </div>
            <video ref={videoRef} className={isScanning ? 'camera-video is-live' : 'camera-video'} playsInline muted aria-label="Live rear-camera road preview" />
            <canvas ref={canvasRef} className="detection-layer" aria-hidden="true" />
            <div className="camera-shade" aria-hidden="true" />

            <div className="camera-topline">
              <span className="camera-state"><span className={isScanning ? 'live-dot' : 'idle-dot'} />{cameraLabel}</span>
              <span className="demo-badge">{isScanning ? 'LIVE · LOCAL' : 'DEMO'}</span>
            </div>

            {!isScanning && cameraState !== 'requesting' && cameraState !== 'denied' && cameraState !== 'unavailable' && (
              <div className="camera-intro">
                <span className="camera-glyph"><CameraIcon /></span>
                <h2>See what&apos;s ahead.<br />Share only what matters.</h2>
                <p>Your camera can spot road objects on this device. No video or audio leaves your phone.</p>
              </div>
            )}

            {cameraState === 'requesting' && (
              <div className="state-panel" role="status">
                <span className="spinner" aria-hidden="true" />
                <h2>Check your browser</h2>
                <p>Choose Allow to use the rear camera. Audio is never requested.</p>
              </div>
            )}

            {(cameraState === 'denied' || cameraState === 'unavailable') && (
              <div className="state-panel state-panel-error" role="alert">
                <h2>{cameraState === 'denied' ? 'Camera access is blocked' : 'Camera is not available'}</h2>
                <p>{cameraState === 'denied' ? 'Allow camera access in browser settings, then try again.' : 'Use hazard reports and nearby alerts without the camera.'}</p>
                {cameraState === 'denied' && <button className="text-action" type="button" onClick={() => void startCamera()}>Try camera again</button>}
              </div>
            )}

            {isScanning && modelState === 'loading' && (
              <div className="model-status" role="status"><span className="spinner small" /> Downloading optional local detection model</div>
            )}
            {isScanning && modelState === 'unavailable' && (
              <div className="model-status warning" role="status">Detection unavailable · camera and reports still work</div>
            )}

            <div className="camera-foot">
              <span>{statusMessage}</span>
              <span className="local-only">On this device</span>
            </div>
          </div>

          <div className="permission-strip">
            <div>
              <span className="permission-icon"><ShieldIcon /></span>
              <p><strong>Camera stays private</strong><span>Used only while scanning. Never uploaded.</span></p>
            </div>
            <span className={`permission-value ${cameraState}`}>{cameraState === 'granted' ? 'Allowed' : cameraState === 'denied' ? 'Blocked' : 'Off'}</span>
          </div>
        </section>

        <section className="action-zone" aria-label="Driver actions">
          <div className="action-grid">
            <button ref={reportButtonRef} className="secondary-action hazard-action" type="button" onClick={() => setReportOpen((open) => !open)} aria-expanded={reportOpen}>
              <span className="action-icon" aria-hidden="true">!</span>
              <span><strong>Report Hazard</strong><small>Tap to choose · mock only</small></span>
              <Chevron open={reportOpen} />
            </button>
            <button ref={assistantButtonRef} className="secondary-action" type="button" onClick={() => setAssistantOpen((open) => !open)} aria-expanded={assistantOpen}>
              <span className="action-icon assistant-icon" aria-hidden="true">⌁</span>
              <span><strong>Ask Pudy</strong><small>Local demo answers · no mic</small></span>
              <Chevron open={assistantOpen} />
            </button>
          </div>

          {reportOpen && (
            <div className="expansion-panel report-panel">
              <div className="panel-heading"><h2>What do you see?</h2><button type="button" onClick={() => { setReportOpen(false); window.requestAnimationFrame(() => reportButtonRef.current?.focus()); }} aria-label="Close hazard choices">Close</button></div>
              <div className="report-options">
                {reportOptions.map((option) => (
                  <button type="button" key={option.kind} onClick={() => submitReport(option.label)}>
                    <span aria-hidden="true">{option.icon}</span>{option.label}
                  </button>
                ))}
              </div>
              <p className="panel-note">Demo reports stay in this tab and are not sent.</p>
            </div>
          )}

          {assistantOpen && (
            <div className="expansion-panel assistant-panel">
              <div className="panel-heading"><h2>Ask Pudy without recording</h2><button type="button" onClick={() => { setAssistantOpen(false); window.requestAnimationFrame(() => assistantButtonRef.current?.focus()); }} aria-label="Close Ask Pudy">Close</button></div>
              <div className="query-row" aria-label="Example questions">
                <button type="button" onClick={() => setAssistantAnswer(assistantAnswers.ahead)}>What&apos;s ahead?</button>
                <button type="button" onClick={() => setAssistantAnswer(assistantAnswers.route)}>Route summary</button>
                <button type="button" onClick={() => setAssistantAnswer(assistantAnswers.clear)}>Is the road clear?</button>
              </div>
              <p className="assistant-answer" aria-live="polite">{assistantAnswer}</p>
              <p className="panel-note">Deterministic mock response. No audio recorded or uploaded.</p>
            </div>
          )}

          <div className="location-rationale">
            <div>
              <span className="location-pin" aria-hidden="true">⌖</span>
              <p><strong>Approximate location</strong><span>Permission preview only. This mock immediately discards coordinates.</span></p>
            </div>
            {locationState === 'rationale' && <button type="button" onClick={requestLocation}>Preview permission</button>}
            {locationState === 'requesting' && <span className="location-state">Waiting…</span>}
            {locationState === 'granted' && <span className="location-state granted">On</span>}
            {(locationState === 'denied' || locationState === 'unavailable') && (
              <button type="button" onClick={requestLocation}>{locationState === 'denied' ? 'Try again' : 'Unavailable'}</button>
            )}
          </div>
        </section>

        <section className="nearby-section" aria-labelledby="nearby-title">
          <button className="section-toggle" type="button" onClick={() => setAlertFeedOpen((open) => !open)} aria-expanded={alertFeedOpen} aria-controls="nearby-feed">
            <span><strong id="nearby-title">Nearby alerts</strong><small>Local mock data · within 2 miles</small></span>
            <span className="alert-count">{showEmptyFeed ? '0' : mockAlerts.length}</span>
            <Chevron open={alertFeedOpen} />
          </button>
          {alertFeedOpen && (
            <div id="nearby-feed" className="nearby-feed">
              <div className="feed-tools">
                <span>{showEmptyFeed ? 'Clear route demo' : 'Ordered by distance'}</span>
                <button type="button" onClick={() => setShowEmptyFeed((empty) => !empty)}>{showEmptyFeed ? 'Show alerts' : 'Preview empty state'}</button>
              </div>
              {showEmptyFeed ? (
                <div className="empty-state">
                  <span aria-hidden="true">✓</span>
                  <div><strong>No nearby reports</strong><p>Keep scanning or add a manual report if conditions change.</p></div>
                </div>
              ) : (
                <div className="alert-list">
                  {mockAlerts.map((alert) => (
                    <article className="alert-row" key={alert.id}>
                      <span className={`alert-symbol ${alert.tone}`} aria-hidden="true">{alert.kind === 'flooding' ? '≈' : alert.kind === 'stalled' ? '■' : '!'}</span>
                      <div className="alert-copy">
                        <h3>{alert.title}</h3>
                        <p>{alert.freshness} ago · {alert.confirmations} confirmation{alert.confirmations === 1 ? '' : 's'} · {alert.confidence} confidence</p>
                      </div>
                      <strong className="distance">{alert.distance}</strong>
                    </article>
                  ))}
                </div>
              )}
              <p className="feed-disclaimer">Reports describe observed road conditions, not people or fault.</p>
            </div>
          )}
        </section>
      </div>

      {reportSuccess && <div className="toast" role="status"><span aria-hidden="true">✓</span>{reportSuccess}</div>}

      <div className="scan-dock">
        <button className={isScanning ? 'scan-button is-scanning' : 'scan-button'} type="button" onClick={handleScan} disabled={cameraState === 'requesting'}>
          <span className="scan-button-icon" aria-hidden="true">{isScanning ? <span className="stop-square" /> : <CameraIcon />}</span>
          <span><strong>{cameraState === 'requesting' ? 'Waiting for Camera' : isScanning ? 'Stop Scan' : 'Start Scan'}</strong><small>{isScanning ? 'Ends camera and local detection' : 'Camera permission requested next'}</small></span>
        </button>
      </div>
    </main>
  );
}
