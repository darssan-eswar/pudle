// One driving session: location, convoy feed, alert policy, speech, dashcam and reroute.
// Expo Go demo: Pudle stays on screen on both phones (no background execution).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { offset } from './core/geo';
import {
  cameraPrompt, DRIVE_STARTED, DRIVE_STOPPED, FEED_LOST, FEED_RESTORED, REPORT_CANCELLED, REPORT_FAILED, reportSent,
  type Persona, type Units,
} from './core/phrases';
import { AlertPolicy, DetectionFilter, type Observation } from './core/policy';
import { estimateCourse, RoadCorridor, type Point, type Relevance } from './core/relevance';
import { HAZARD_KINDS, SIDES, type HazardEvent, type HazardKind, type HazardLocation, type HazardSide, type ReceiverFix } from './core/types';
import * as api from './lib/backend';
import { configured, supabase } from './lib/supabase';
import { speak, stopSpeaking } from './lib/voice';

export interface Place { name: string; latitude: number; longitude: number }
export interface LogLine { id: string; at: number; text: string }
export interface Prompt {
  kind: HazardKind; side: HazardSide; blocksRoad: boolean; label: string; confidence: number;
  capturedAt: number; location: HazardLocation | null; status: 'asking' | 'sending' | 'done'; note?: string;
}
export type FeedState = 'idle' | 'connecting' | 'live' | 'problem' | 'offline';

interface Settings {
  convoyId: string | null; persona: Persona; cloudVoice: boolean; units: Units; shareLocation: boolean;
  destination: Place | null; detour: Place | null;
}
const DEFAULTS: Settings = {
  convoyId: null, persona: 'buddy', cloudVoice: true, units: 'imperial', shareLocation: false, destination: null, detour: null,
};

export function useDrive() {
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [convoys, setConvoys] = useState<api.Convoy[]>([]);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fix, setFix] = useState<ReceiverFix | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [feed, setFeed] = useState<FeedState>('idle');
  const [corridor, setCorridor] = useState<RoadCorridor | null>(null);
  const [recording, setRecording] = useState<Point[] | null>(null);
  const [dashcam, setDashcam] = useState(false);
  const [detector, setDetector] = useState('Off');
  const [lastSeen, setLastSeen] = useState('');
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [blockage, setBlockage] = useState<HazardEvent | null>(null);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [latency, setLatency] = useState<{ detect: number[]; deliver: number[] }>({ detect: [], deliver: [] });
  const [error, setError] = useState<string | null>(null);

  // Refs read by async loops (avoid stale closures).
  const policy = useRef(new AlertPolicy());
  const filter = useRef(new DetectionFilter());
  const fixRef = useRef<ReceiverFix | null>(null);
  const recent = useRef<ReceiverFix[]>([]);
  const settingsRef = useRef(settings);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const promptRef = useRef<Prompt | null>(null);
  const recordingRef = useRef<Point[] | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  const cameraReady = useRef(false);
  const dashcamRef = useRef(false);
  const feedRef = useRef<FeedState>('idle');
  const loggedPending = useRef(new Set<string>());
  const watcher = useRef<Location.LocationSubscription | null>(null);

  settingsRef.current = settings;
  promptRef.current = prompt;

  const note = useCallback((text: string) => {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, at: Date.now(), text }, ...l].slice(0, 200));
  }, []);

  const say = useCallback((text: string, cloud = true) => {
    if (mutedRef.current) return Promise.resolve(null);
    const s = settingsRef.current;
    return speak(text, s.persona, cloud && s.cloudVoice).catch(() => null);
  }, []);

  // ---- settings + auth ---------------------------------------------------------------
  useEffect(() => {
    AsyncStorage.getItem('pudle.settings').then((raw) => {
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
    }).catch(() => {});
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      AsyncStorage.setItem('pudle.settings', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const loadConvoys = useCallback(async () => {
    try {
      const list = await api.listConvoys();
      setConvoys(list);
      const current = settingsRef.current.convoyId;
      if (!current || !list.some((c) => c.id === current)) update({ convoyId: list[0]?.id ?? null });
    } catch (e) { setError(String((e as Error).message)); }
  }, [update]);

  useEffect(() => { if (session) loadConvoys(); }, [session, loadConvoys]);

  // ---- location -------------------------------------------------------------------------
  const startLocation = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') { setLocationDenied(true); note('Location permission denied'); return; }
    setLocationDenied(false);
    watcher.current?.remove();
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        const c = loc.coords;
        const raw: ReceiverFix = {
          latitude: c.latitude, longitude: c.longitude, accuracyMeters: c.accuracy ?? 999,
          courseDegrees: c.heading != null && c.heading >= 0 && (c.speed ?? 0) > 2 ? c.heading : null,
          speedMps: c.speed != null && c.speed >= 0 ? c.speed : null, timestamp: loc.timestamp,
        };
        recent.current = [...recent.current.filter((f) => raw.timestamp - f.timestamp <= 30_000), raw];
        const f = raw.courseDegrees == null ? { ...raw, courseDegrees: estimateCourse(recent.current) } : raw;
        fixRef.current = f;
        setFix(f);
        const rec = recordingRef.current;
        if (rec && f.accuracyMeters <= 30) {
          const last = rec[rec.length - 1];
          const far = !last || Math.hypot((f.latitude - last[0]) * 111_320, (f.longitude - last[1]) * 111_320 * Math.cos(f.latitude * Math.PI / 180)) >= 15;
          if (far && rec.length < 2000) { recordingRef.current = [...rec, [f.latitude, f.longitude]]; setRecording(recordingRef.current); }
        }
      },
    );
  }, [note]);

  // ---- feed polling ----------------------------------------------------------------------
  const setFeedState = useCallback((next: FeedState) => {
    const was = feedRef.current;
    feedRef.current = next;
    setFeed(next);
    if (activeRef.current && was === 'live' && (next === 'problem' || next === 'offline')) { note('Feed lost'); say(FEED_LOST, false); }
    if (activeRef.current && (was === 'problem' || was === 'offline') && next === 'live') { note('Feed restored'); say(FEED_RESTORED, false); }
  }, [note, say]);

  const handle = useCallback(async (event: HazardEvent, via: string) => {
    const now = Date.now();
    const p = policy.current;
    p.muted = mutedRef.current;
    p.persona = settingsRef.current.persona;
    p.units = settingsRef.current.units;
    const decision = p.decide(event, fixRef.current, now);
    if (decision.type === 'speak') {
      if (event.blocksRoad && decision.relevance.type === 'ahead') setBlockage(event);
      setLastAlert(decision.phrase);
      const spoken = await say(decision.phrase);
      const startedAt = spoken?.startedAt ?? Date.now();
      setLatency((l) => ({ ...l, deliver: [...l.deliver, (startedAt - event.createdAt) / 1000].slice(-100) }));
      note(`Spoke (${via}, ${describe(decision.relevance)}, ${spoken?.voice ?? 'muted'}) ${((startedAt - event.createdAt) / 1000).toFixed(1)}s after report`);
    } else if (!decision.final) {
      if (!loggedPending.current.has(event.id)) { loggedPending.current.add(event.id); note(`Report ${event.kind}: ${decision.reason}`); }
    } else if (decision.reason !== 'duplicate' && decision.reason !== 'drive not active') {
      note(`Report ${event.kind}: ${decision.reason}`);
    }
  }, [note, say]);

  useEffect(() => {
    if (!active || !session || !settings.convoyId) { setFeedState(active ? 'idle' : 'idle'); return; }
    let cancelled = false;
    const convoyId = settings.convoyId;
    let lastCorridor = 0;
    let delay = 2000;
    (async () => {
      setFeedState('connecting');
      while (!cancelled) {
        try {
          if (Date.now() - lastCorridor > 60_000) {
            lastCorridor = Date.now();
            const c = await api.fetchCorridor(convoyId).catch(() => null);
            if (c) { policy.current.corridor = c; setCorridor(c); }
          }
          const { events } = await api.fetchEvents(convoyId, Date.now());
          if (cancelled) break;
          setFeedState('live');
          for (const e of events) await handle(e, 'feed');
          delay = 2000;
        } catch (e) {
          setFeedState(String((e as Error).message).toLowerCase().includes('network') ? 'offline' : 'problem');
          delay = Math.min(delay * 2, 30_000);
        }
        await sleep(delay);
      }
    })();
    return () => { cancelled = true; };
  }, [active, session, settings.convoyId, handle, setFeedState]);

  // ---- dashcam -------------------------------------------------------------------------------
  const askDriver = useCallback((o: Observation, label: string, capturedAt: number, f: ReceiverFix | null) => {
    let location: HazardLocation | null = null;
    if (f && Date.now() - f.timestamp < 10_000 && f.accuracyMeters <= 50) {
      // The object is a little ahead of the camera: place it ~25 m along our course.
      const [lat, lon] = f.courseDegrees != null ? offset(f.latitude, f.longitude, 25, f.courseDegrees) : [f.latitude, f.longitude];
      location = { latitude: lat, longitude: lon, accuracyMeters: Math.max(f.accuracyMeters, 10), headingDegrees: f.courseDegrees ?? null };
    }
    const next: Prompt = { kind: o.kind, side: o.side, blocksRoad: o.blocksRoad, label, confidence: o.confidence, capturedAt, location, status: 'asking' };
    promptRef.current = next;
    setPrompt(next);
    note(`Camera flagged possible ${o.kind} (${o.side}, ${Math.round(o.confidence * 100)}%)${location ? '' : ' · no GPS fix'}`);
    say(cameraPrompt(o.kind, o.side, o.blocksRoad, settingsRef.current.persona));
    setTimeout(() => { if (promptRef.current === next) setPrompt(null); }, 25_000);
  }, [note, say]);

  useEffect(() => {
    dashcamRef.current = dashcam && active;
    if (!dashcam || !active || !session) { setDetector(dashcam ? 'Start a drive to watch the road' : 'Off'); return; }
    let cancelled = false;
    let errors = 0;
    filter.current.reset();
    setDetector('Starting camera…');
    (async () => {
      while (!cancelled) {
        const started = Date.now();
        const cam = cameraRef.current;
        if (cam && cameraReady.current && !promptRef.current) {
          try {
            const capturedAt = Date.now();
            const f = fixRef.current;
            const photo = await cam.takePictureAsync({ base64: true, quality: 0.35, shutterSound: false });
            if (cancelled) break;
            if (photo?.base64) {
              const t0 = Date.now();
              const r = await api.detectHazard(photo.base64);
              const rtt = (Date.now() - t0) / 1000;
              setLatency((l) => ({ ...l, detect: [...l.detect, rtt].slice(-200) }));
              errors = 0;
              setDetector(`Watching the road · ${rtt.toFixed(1)}s per check`);
              setLastSeen(r.hazard ? `${r.label || r.kind} · ${r.side} · ${Math.round(r.confidence * 100)}%${r.blocks_road ? ' · may block road' : ''}` : 'Clear');
              const kind = (HAZARD_KINDS as readonly string[]).includes(r.kind) ? (r.kind as HazardKind) : null;
              const side = (SIDES as readonly string[]).includes(r.side) ? (r.side as HazardSide) : 'unknown';
              const accepted = filter.current.add(r.hazard && kind
                ? { kind, side, blocksRoad: r.blocks_road, confidence: r.confidence, at: capturedAt } : null, Date.now());
              if (accepted && !cancelled) askDriver(accepted, r.label, capturedAt, f);
            }
          } catch (e) {
            errors++;
            setDetector(`Hazard checker problem: ${(e as Error).message}`);
            if (errors === 1) note(`Hazard checker: ${(e as Error).message}`);
          }
        }
        const target = errors ? Math.min(10_000, errors * 2000) : 1000;
        await sleep(Math.max(150, target - (Date.now() - started)));
      }
    })();
    return () => { cancelled = true; };
  }, [dashcam, active, session, askDriver, note]);

  const confirmReport = useCallback(async () => {
    const p = promptRef.current;
    const convoyId = settingsRef.current.convoyId;
    if (!p) return;
    const finish = (n: string) => { const next = { ...p, status: 'done' as const, note: n }; promptRef.current = next; setPrompt(next); setTimeout(() => { if (promptRef.current === next) setPrompt(null); }, 4000); };
    if (!convoyId) { finish('Join a convoy first'); return; }
    if (!p.location) { finish('No GPS position — not sent'); say("I don't have your position, so I can't share it.", false); return; }
    if (!settingsRef.current.shareLocation) { finish('Turn on location sharing in Settings'); say('Location sharing is off, so I can\'t share it.', false); return; }
    const sending = { ...p, status: 'sending' as const };
    promptRef.current = sending;
    setPrompt(sending);
    try {
      await api.report({ convoyId, kind: p.kind, side: p.side, blocksRoad: p.blocksRoad, source: 'driver_confirmed_camera',
                         observedAt: p.capturedAt, location: p.location });
      note(`Camera report sent: ${p.kind}, ${p.side}${p.blocksRoad ? ', possible blockage' : ''}`);
      finish('Sent to drivers behind you');
      say(reportSent(p.blocksRoad));
    } catch (e) {
      note(`Report failed: ${(e as Error).message}`);
      finish(`Not sent: ${(e as Error).message}`);
      say(REPORT_FAILED, false);
    }
  }, [note, say]);

  const cancelReport = useCallback(() => {
    if (!promptRef.current) return;
    promptRef.current = null;
    setPrompt(null);
    note('Camera report cancelled');
    say(REPORT_CANCELLED, false);
  }, [note, say]);

  // ---- drive lifecycle --------------------------------------------------------------------
  const startDrive = useCallback(async () => {
    if (activeRef.current) return;
    policy.current.reset();
    policy.current.active = true;
    policy.current.ownUserId = session?.user.id ?? null;
    policy.current.corridor = corridor;
    loggedPending.current.clear();
    activeRef.current = true;
    setActive(true);
    setBlockage(null);
    setLastAlert(null);
    await startLocation();
    note('Drive started');
    say(DRIVE_STARTED, false);
  }, [session, corridor, startLocation, note, say]);

  const stopDrive = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    policy.current.active = false;
    policy.current.reset();
    setActive(false);
    watcher.current?.remove();
    watcher.current = null;
    recent.current = [];
    fixRef.current = null;
    setFix(null);
    recordingRef.current = null;
    setRecording(null);
    setPrompt(null);
    setBlockage(null);
    stopSpeaking();
    note('Drive stopped');
    say(DRIVE_STOPPED, false);
  }, [note, say]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) stopSpeaking();
    note(mutedRef.current ? 'Muted (muted reports are not replayed)' : 'Unmuted');
  }, [note]);

  // ---- account / convoy / consent ---------------------------------------------------------
  const signIn = useCallback(async (email: string, password: string, create: boolean) => {
    setError(null);
    const { error: e, data } = create
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (e) { setError(e.message); return; }
    if (create && !data.session) setError('Account created. Confirm it from the email, then sign in.');
  }, []);

  const signOut = useCallback(async () => { stopDrive(); await supabase.auth.signOut(); setConvoys([]); }, [stopDrive]);

  const createConvoy = useCallback(async (name: string) => {
    try { const id = await api.createConvoy(name); update({ convoyId: id }); await loadConvoys(); } catch (e) { setError((e as Error).message); }
  }, [update, loadConvoys]);

  const joinConvoy = useCallback(async (code: string) => {
    try { const id = await api.joinConvoy(code); update({ convoyId: id }); await loadConvoys(); } catch (e) { setError((e as Error).message); }
  }, [update, loadConvoys]);

  const setShareLocation = useCallback(async (value: boolean) => {
    try { await api.setLocationConsent(value); update({ shareLocation: value }); if (!value) { setCorridor(null); policy.current.corridor = null; } }
    catch (e) { setError((e as Error).message); }
  }, [update]);

  // ---- demo road ----------------------------------------------------------------------------
  const startRecording = useCallback(() => {
    if (!activeRef.current) { setError('Start a drive first, then record while driving the demo road.'); return; }
    recordingRef.current = [];
    setRecording([]);
    note('Recording demo road');
  }, [note]);

  const finishRecording = useCallback(async (name: string) => {
    const points = recordingRef.current ?? [];
    recordingRef.current = null;
    setRecording(null);
    const convoyId = settingsRef.current.convoyId;
    const c = RoadCorridor.create('local', name, points);
    if (!convoyId) { setError('Choose a convoy first.'); return; }
    if (!c) { setError('Too short — drive at least a few hundred feet while recording.'); return; }
    if (!settingsRef.current.shareLocation) { setError('Turn on location sharing to save the road.'); return; }
    try {
      await api.saveCorridor(convoyId, name, points);
      setCorridor(c);
      policy.current.corridor = c;
      note(`Saved demo road "${name}" (${(c.length / 1000).toFixed(1)} km, ${points.length} points)`);
    } catch (e) { setError((e as Error).message); }
  }, [note]);

  // ---- tests, manual report, reroute ------------------------------------------------------
  const injectTest = useCallback((blocksRoad = false) => {
    const f = fixRef.current;
    let location: HazardLocation | null = null;
    if (f) {
      const [lat, lon] = offset(f.latitude, f.longitude, 800, f.courseDegrees ?? 0);
      location = { latitude: lat, longitude: lon, accuracyMeters: 10, headingDegrees: f.courseDegrees ?? null };
    }
    const now = Date.now();
    handle({ id: api.newUUID(), kind: blocksRoad ? 'tree' : 'object', source: 'labeled_test', side: 'right', blocksRoad,
             observedAt: now, createdAt: now, expiresAt: now + 120_000, location }, 'test');
  }, [handle]);

  const manualReport = useCallback(async (kind: HazardKind, side: HazardSide, blocksRoad: boolean) => {
    const convoyId = settingsRef.current.convoyId;
    if (!convoyId) { setError('Choose a convoy first.'); return false; }
    const f = fixRef.current;
    const location = settingsRef.current.shareLocation && f && Date.now() - f.timestamp < 15_000 && f.accuracyMeters <= 50
      ? { latitude: f.latitude, longitude: f.longitude, accuracyMeters: Math.max(f.accuracyMeters, 5), headingDegrees: f.courseDegrees ?? null }
      : null;
    try {
      await api.report({ convoyId, kind, side, blocksRoad, source: 'convoy_member', observedAt: Date.now(), location });
      note(`Report sent: ${kind}${location ? '' : ' (no location)'}`);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }, [note]);

  const openMaps = useCallback(async (viaDetour: boolean) => {
    const { destination, detour } = settingsRef.current;
    if (!destination) { setError('Set a destination in Settings → Demo route.'); return; }
    const c = (p: Place) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
    const wp = viaDetour && detour ? detour : null;
    const app = `comgooglemaps://?daddr=${wp ? `${c(wp)}+to:${c(destination)}` : c(destination)}&directionsmode=driving`;
    const web = `https://www.google.com/maps/dir/?api=1&destination=${c(destination)}&travelmode=driving&dir_action=navigate${wp ? `&waypoints=${c(wp)}` : ''}`;
    const canApp = await Linking.canOpenURL('comgooglemaps://').catch(() => false);
    await Linking.openURL(canApp ? app : web);
    note(`Opened Google Maps${wp ? ' via detour' : ''}`);
  }, [note]);

  const searchPlaces = useCallback(async (query: string): Promise<Place[]> => {
    try {
      const results = await Location.geocodeAsync(query);
      return results.slice(0, 5).map((r, i) => ({ name: `${query}${results.length > 1 ? ` (${i + 1})` : ''}`, latitude: r.latitude, longitude: r.longitude }));
    } catch { return []; }
  }, []);

  const useHereAsDetour = useCallback(() => {
    const f = fixRef.current;
    if (!f) { setError('No GPS fix yet — start a drive outdoors first.'); return; }
    update({ detour: { name: 'Detour point (here)', latitude: f.latitude, longitude: f.longitude } });
  }, [update]);

  return {
    configured, session, settings, update, convoys, loadConvoys, active, muted, fix, locationDenied, feed, corridor,
    recording, dashcam, setDashcam, detector, lastSeen, prompt, blockage, lastAlert, log, latency, error, setError,
    cameraRef, onCameraReady: () => { cameraReady.current = true; }, onCameraGone: () => { cameraReady.current = false; },
    startDrive, stopDrive, toggleMute, confirmReport, cancelReport, signIn, signOut, createConvoy, joinConvoy,
    setShareLocation, startRecording, finishRecording, injectTest, manualReport, openMaps, searchPlaces, useHereAsDetour,
  };
}

export type Drive = ReturnType<typeof useDrive>;

function describe(r: Relevance): string {
  switch (r.type) {
    case 'ahead': return `ahead ${Math.round(r.meters)}m${r.onRecordedRoad ? ' on demo road' : ' by heading'}`;
    case 'nearby': return `nearby ${Math.round(r.meters)}m`;
    case 'receiverUnknown': return `position unknown (${r.why})`;
    case 'unlocated': return 'unlocated';
    case 'notRelevant': return r.why;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
