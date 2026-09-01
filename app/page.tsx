'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type RoadEvent = {
  id: string;
  type: string;
  confidence: number;
  source: string;
  createdAt: number;
  expiresAt: number;
  distanceMiles: number;
};

type Prediction = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
};

type Detector = {
  detect: (input: HTMLVideoElement) => Promise<Prediction[]>;
};

interface SpeechRecognitionResultLike {
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  results: { 0: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

interface SpeechWindow extends Window {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
}

const DEFAULT_POSITION = { latitude: 37.7749, longitude: -122.4194 };

const eventLabels: Record<string, string> = {
  'road-hazard': 'Road hazard',
  'reckless-driver': 'Reckless driver',
  crash: 'Crash reported',
  flooding: 'Flooding',
  'object-on-road': 'Object on road',
  'heavy-traffic': 'Heavy traffic',
  'parking-available': 'Parking likely',
  'gas-price': 'Gas price update',
};

const reportTypes = [
  { key: 'road-hazard', label: 'Road hazard', icon: '△' },
  { key: 'reckless-driver', label: 'Reckless driver', icon: '↯' },
  { key: 'crash', label: 'Crash', icon: '✕' },
  { key: 'flooding', label: 'Flooding', icon: '≈' },
];

const roadClasses = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person', 'traffic light', 'stop sign']);

function coarse(value: number) {
  return Math.round(value * 1000) / 1000;
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.round(seconds / 60)} min`;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const detectingRef = useRef(false);

  const [events, setEvents] = useState<RoadEvent[]>([]);
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [locationMode, setLocationMode] = useState<'demo' | 'live'>('demo');
  const [isScanning, setIsScanning] = useState(false);
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [posting, setPosting] = useState<string | null>(null);
  const [notice, setNotice] = useState('Demo location · San Francisco');
  const [isListening, setIsListening] = useState(false);
  const [voiceAnswer, setVoiceAnswer] = useState('“What’s ahead of me?”');

  const loadEvents = useCallback(async (currentPosition = position) => {
    try {
      const lat = coarse(currentPosition.latitude);
      const lng = coarse(currentPosition.longitude);
      const response = await fetch(`/api/events?lat=${lat}&lng=${lng}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load nearby events.');
      const data = await response.json() as { events: RoadEvent[] };
      setEvents(data.events);
    } catch {
      setNotice('Live mesh reconnecting…');
    }
  }, [position]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadEvents(), 0);
    const interval = window.setInterval(() => void loadEvents(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadEvents]);

  useEffect(() => () => {
    if (detectionLoopRef.current) window.clearInterval(detectionLoopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const drawPredictions = useCallback((items: Prediction[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 3;
    context.font = '600 16px system-ui';

    items.forEach((item) => {
      const [x, y, width, height] = item.bbox;
      const label = `${item.class.toUpperCase()} ${Math.round(item.score * 100)}%`;
      context.strokeStyle = '#c8ff3d';
      context.fillStyle = '#c8ff3d';
      context.strokeRect(x, y, width, height);
      const textWidth = context.measureText(label).width + 16;
      context.fillRect(x, Math.max(0, y - 28), textWidth, 28);
      context.fillStyle = '#081006';
      context.fillText(label, x + 8, Math.max(19, y - 8));
    });
  }, []);

  const beginDetection = useCallback(async () => {
    setModelState('loading');
    try {
      const [tf, cocoSsd] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ]);
      await tf.ready();
      detectorRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setModelState('ready');
      detectionLoopRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (!video || !detector || detectingRef.current || video.readyState < 2) return;
        detectingRef.current = true;
        try {
          const result = (await detector.detect(video))
            .filter((prediction) => prediction.score >= 0.52 && roadClasses.has(prediction.class))
            .slice(0, 8);
          setPredictions(result);
          drawPredictions(result);
        } finally {
          detectingRef.current = false;
        }
      }, 850);
    } catch {
      setModelState('unavailable');
      setNotice('Camera live · edge model unavailable');
    }
  }, [drawPredictions]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextPosition = { latitude: coords.latitude, longitude: coords.longitude };
        setPosition(nextPosition);
        setLocationMode('live');
        setNotice('Live location · shared at ~110 m precision');
        void loadEvents(nextPosition);
      },
      () => setNotice('Camera live · using San Francisco demo area'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, [loadEvents]);

  const startScan = useCallback(async () => {
    if (isScanning) {
      if (detectionLoopRef.current) window.clearInterval(detectionLoopRef.current);
      detectionLoopRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      detectorRef.current = null;
      setPredictions([]);
      setIsScanning(false);
      setModelState('idle');
      const context = canvasRef.current?.getContext('2d');
      if (context && canvasRef.current) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      return;
    }

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
      setIsScanning(true);
      setNotice('Camera live · loading edge detector');
      requestLocation();
      void beginDetection();
    } catch {
      setNotice('Camera access is needed to start the road scan');
    }
  }, [beginDetection, isScanning, requestLocation]);

  const reportEvent = useCallback(async (type: string) => {
    setPosting(type);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          latitude: coarse(position.latitude),
          longitude: coarse(position.longitude),
          confidence: 1,
          source: 'manual',
        }),
      });
      if (!response.ok) throw new Error('Report failed.');
      setNotice(`${eventLabels[type]} shared anonymously · expires in 30 min`);
      await loadEvents();
    } catch {
      setNotice('Could not share the report · try again');
    } finally {
      setPosting(null);
    }
  }, [loadEvents, position]);

  const answerQuestion = useCallback((question: string) => {
    const closest = events[0];
    let answer = 'The road ahead looks clear within two miles.';
    if (closest) {
      answer = `${eventLabels[closest.type] ?? 'A road event'} is ${closest.distanceMiles.toFixed(1)} miles ahead.`;
    }
    if (/park/i.test(question)) {
      const parking = events.find((event) => event.type === 'parking-available');
      answer = parking ? `Parking was recently seen ${parking.distanceMiles.toFixed(1)} miles away.` : 'No recent parking signal is available nearby.';
    }
    setVoiceAnswer(`“${answer}”`);
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  }, [events]);

  const askPulzar = useCallback(() => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      answerQuestion('what is ahead');
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => answerQuestion(event.results[0][0].transcript);
    recognition.onerror = () => setVoiceAnswer('“I couldn’t hear that. Tap to try again.”');
    recognition.onend = () => setIsListening(false);
    setIsListening(true);
    setVoiceAnswer('Listening…');
    recognition.start();
  }, [answerQuestion]);

  const detectedSummary = predictions.length
    ? `${predictions.length} road object${predictions.length === 1 ? '' : 's'} seen locally`
    : modelState === 'ready' ? 'Scanning the road locally' : modelState === 'loading' ? 'Loading edge AI model' : 'Camera ready';

  return (
    <main className="min-h-screen bg-[#060807] text-[#f5f7f2]">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#060807]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#c8ff3d] text-sm font-black text-[#0a0d09]">P</div>
            <div><p className="text-[15px] font-semibold tracking-tight">PULZAR</p><p className="text-[9px] font-medium uppercase tracking-[0.24em] text-white/40">Road intelligence</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#c8ff3d]/20 bg-[#c8ff3d]/5 px-3 py-2 text-[11px] font-medium text-[#c8ff3d]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8ff3d]" />
            {isScanning ? 'Edge scan active' : 'Privacy mode active'}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,.7fr)]">
        <section className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0c100d] shadow-2xl shadow-black/30">
          <div className="relative aspect-[16/10] min-h-[430px] overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#26312a_0%,#111713_42%,#080b09_100%)]">
            <video ref={videoRef} className={`absolute inset-0 h-full w-full object-cover ${isScanning ? 'opacity-100' : 'opacity-0'}`} playsInline muted aria-label="Live road camera" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
            {isScanning && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/55" />}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent p-5">
              <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">{isScanning ? detectedSummary : 'Camera offline'}</span>
              <span className="font-mono text-[10px] text-white/55">{coarse(position.latitude).toFixed(3)}° · {coarse(position.longitude).toFixed(3)}°</span>
            </div>

            {!isScanning && <div className="absolute inset-0 grid place-items-center">
              <div className="max-w-sm px-7 text-center">
                <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-[#c8ff3d]/30 bg-[#c8ff3d]/10 text-2xl text-[#c8ff3d]">◉</div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Turn this phone into a smarter dashcam.</h1>
                <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-white/45">Detect road objects locally. Share only anonymous, short-lived metadata with drivers nearby.</p>
              </div>
            </div>}

            <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-md">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-[#c8ff3d]">⌁</div>
                <div className="min-w-0"><p className="truncate text-xs font-semibold">{notice}</p><p className="mt-0.5 text-[10px] text-white/40">Video stays on-device · reports use approximate coordinates</p></div>
              </div>
              <button onClick={startScan} className={`shrink-0 rounded-full px-5 py-2.5 text-xs font-bold ${isScanning ? 'border border-white/15 bg-white/10 text-white' : 'bg-[#c8ff3d] text-[#0a0d09]'}`}>{isScanning ? 'Stop scan' : 'Start scan'}</button>
            </div>
          </div>

          <div className="border-t border-white/10 p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Quick report</h2><span className="text-[10px] uppercase tracking-[0.17em] text-white/35">Expires in 30 min</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {reportTypes.map((report) => <button key={report.key} onClick={() => void reportEvent(report.key)} disabled={posting !== null} className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-3 text-left text-xs font-medium text-white/65 transition hover:border-[#c8ff3d]/40 hover:text-white disabled:opacity-40"><span className="mr-2 text-[#c8ff3d]">{report.icon}</span>{posting === report.key ? 'Sharing…' : report.label}</button>)}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-[26px] border border-white/10 bg-[#0c100d] p-5">
            <div className="mb-5 flex items-end justify-between">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[#c8ff3d]">Live mesh</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Near you now</h2></div>
              <p className="font-mono text-[10px] text-white/35">2 MI · {locationMode.toUpperCase()}</p>
            </div>
            <div className="relative mb-5 aspect-[2/1] overflow-hidden rounded-2xl border border-white/10 bg-[#090c0a]">
              <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
              <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#c8ff3d]/25 bg-[#c8ff3d]/5" />
              <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c8ff3d] shadow-[0_0_20px_#c8ff3d]" />
              {events.slice(0, 6).map((event, index) => <span key={event.id} className="absolute h-2 w-2 rounded-full bg-[#ffca58] shadow-[0_0_10px_currentColor]" style={{ left: `${24 + ((index * 29) % 57)}%`, top: `${20 + ((index * 37) % 58)}%` }} />)}
            </div>
            <div className="max-h-[296px] space-y-2 overflow-y-auto pr-1">
              {events.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-5 py-7 text-center"><p className="text-sm font-medium text-white/70">Road looks clear</p><p className="mt-1 text-xs leading-5 text-white/35">No active reports within two miles. Add a quick report to test the live mesh.</p></div>}
              {events.map((event) => (
                <article key={event.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-3.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${event.type === 'crash' || event.type === 'reckless-driver' ? 'bg-[#ff6b4a]' : 'bg-[#ffca58]'}`} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{eventLabels[event.type] ?? 'Road event'}</p><p className="mt-0.5 text-[10px] text-white/35">{timeAgo(event.createdAt)} ago · {event.source === 'edge-ai' ? 'edge detected' : 'anonymous report'}</p></div>
                  <p className="font-mono text-[11px] text-white/50">{event.distanceMiles < 0.1 ? '<0.1' : event.distanceMiles.toFixed(1)} mi</p>
                </article>
              ))}
            </div>
          </section>

          <button onClick={askPulzar} className="flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-white px-5 py-4 text-left text-[#0b0d0b]">
            <span className="min-w-0 pr-3"><span className="block text-[10px] font-semibold uppercase tracking-[0.17em] text-black/40">{isListening ? 'Listening' : 'Ask Pulzar'}</span><span className="mt-0.5 block truncate text-sm font-semibold">{voiceAnswer}</span></span><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0b0d0b] text-white ${isListening ? 'animate-pulse' : ''}`}>⌁</span>
          </button>
        </aside>
      </div>
    </main>
  );
}
