'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PudleButton, PudleStatusBadge, PudyOrb, type PudyState } from '@/components/pudle';
import { groundPudyAnswer, parsePudyRequest, type PudyAction } from '@/lib/client/app';

interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface PudyAssistantProps {
  enabled: boolean;
  sceneLabels: string[];
  analysisLabels: string[];
  nearbyLabels: string[];
  onAction: (action: PudyAction) => string | Promise<string>;
}

export interface PudyAssistantHandle {
  stop(): void;
}

export const PudyAssistant = forwardRef<PudyAssistantHandle, PudyAssistantProps>(
function PudyAssistant({
  enabled,
  sceneLabels,
  analysisLabels,
  nearbyLabels,
  onAction,
}, ref) {
  const recognition = useRef<SpeechRecognitionLike | undefined>(undefined);
  const resumeListening = useRef<() => void>(() => undefined);
  const voiceActive = useRef(false);
  const speechBusy = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const [state, setState] = useState<PudyState>('idle');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('Ask about only what Pudle currently displays.');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const stopRecognition = useCallback(() => {
    const active = recognition.current;
    recognition.current = undefined;
    active?.abort();
  }, []);

  const stopVoice = useCallback(() => {
    generation.current += 1;
    voiceActive.current = false;
    speechBusy.current = false;
    stopRecognition();
    window.speechSynthesis?.cancel();
    if (mounted.current) {
      setVoiceEnabled(false);
      setState('idle');
    }
  }, [stopRecognition]);

  const pauseVoice = useCallback(() => {
    generation.current += 1;
    speechBusy.current = false;
    stopRecognition();
    window.speechSynthesis?.cancel();
    if (mounted.current) setState('idle');
  }, [stopRecognition]);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    if (!enabled) stopVoice();
  }, [enabled, stopVoice]);

  useEffect(() => {
    mounted.current = true;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pauseVoice();
      } else if (voiceActive.current) {
        resumeListening.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      stopVoice();
    };
  }, [pauseVoice, stopVoice]);

  useImperativeHandle(ref, () => ({ stop: stopVoice }), [stopVoice]);

  const speak = useCallback((message: string, requestGeneration: number) => {
    if (!mounted.current || requestGeneration !== generation.current) return;
    stopRecognition();
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      speechBusy.current = false;
      setState('idle');
      resumeListening.current();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.onend = () => {
      if (!mounted.current || requestGeneration !== generation.current) return;
      speechBusy.current = false;
      setState('idle');
      resumeListening.current();
    };
    utterance.onerror = () => {
      if (!mounted.current || requestGeneration !== generation.current) return;
      speechBusy.current = false;
      setAnswer('Speech playback failed. Voice listening is paused; use text or enable voice again.');
      voiceActive.current = false;
      setVoiceEnabled(false);
      setState('error');
    };
    speechBusy.current = true;
    setState('speaking');
    window.speechSynthesis.speak(utterance);
  }, [stopRecognition]);

  const process = useCallback(async (input: string, requireWakePhrase: boolean) => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    const request = parsePudyRequest(input, requireWakePhrase);
    if (request.kind === 'missing-wake-phrase') {
      speechBusy.current = false;
      setAnswer('Listening for “Hey Pudy.” You can also type below.');
      setState('listening');
      resumeListening.current();
      return;
    }
    speechBusy.current = true;
    setState('thinking');
    let response = groundPudyAnswer(request, {
      sceneLabels,
      nearbyLabels,
      analysisLabels,
    });
    try {
      if (request.kind === 'action') response = await onAction(request.action);
    } catch {
      if (
        mounted.current
        && enabled
        && requestGeneration === generation.current
      ) {
        speechBusy.current = false;
        setAnswer('Pudy could not complete that action. Nothing was shared or saved.');
        setState('error');
        resumeListening.current();
      }
      return;
    }
    if (
      !mounted.current
      || !enabled
      || requestGeneration !== generation.current
    ) return;
    setAnswer(response);
    speak(response, requestGeneration);
  }, [analysisLabels, enabled, nearbyLabels, onAction, sceneLabels, speak]);

  const listen = useCallback(() => {
    if (
      !mounted.current
      || !enabled
      || !voiceActive.current
      || document.visibilityState === 'hidden'
      || recognition.current
      || speechBusy.current
    ) return;
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      voiceActive.current = false;
      setVoiceEnabled(false);
      setAnswer('Speech recognition is unavailable. Type your request below.');
      setState('error');
      return;
    }
    const listenGeneration = generation.current + 1;
    generation.current = listenGeneration;
    const next = new Recognition();
    next.continuous = false;
    next.interimResults = false;
    next.lang = navigator.language || 'en-US';
    next.onresult = (event) => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      recognition.current = undefined;
      next.stop();
      void process(event.results[0]?.[0]?.transcript ?? '', true);
    };
    next.onerror = (event) => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      recognition.current = undefined;
      voiceActive.current = false;
      speechBusy.current = false;
      setVoiceEnabled(false);
      setAnswer(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone permission was denied. Allow it in browser settings or use text.'
          : 'Voice recognition stopped unexpectedly. Enable voice to retry, or use text.',
      );
      setState('error');
    };
    next.onend = () => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      recognition.current = undefined;
      if (voiceActive.current && document.visibilityState !== 'hidden') {
        setState('listening');
        window.setTimeout(() => resumeListening.current(), 0);
      } else {
        setState('idle');
      }
    };
    recognition.current = next;
    setState('listening');
    try {
      next.start();
    } catch {
      if (recognition.current === next && listenGeneration === generation.current) {
        recognition.current = undefined;
        voiceActive.current = false;
        setVoiceEnabled(false);
        setAnswer('Listening could not start. Check microphone permission or use text.');
        setState('error');
      }
    }
  }, [enabled, process]);

  resumeListening.current = listen;

  function enableVoice() {
    voiceActive.current = true;
    setVoiceEnabled(true);
    setAnswer('Listening for “Hey Pudy.” Keep this page visible, or use text below.');
    listen();
  }

  return (
    <section className="pudle-card pudle-assistant" aria-labelledby="pudy-title">
      <div className="pudle-panel-header">
        <div>
          <p className="pudle-eyebrow">Foreground assistant</p>
          <h2 id="pudy-title">Ask Pudy</h2>
        </div>
        <PudleStatusBadge tone={state === 'error' ? 'danger' : state === 'idle' ? 'neutral' : 'accent'}>{state}</PudleStatusBadge>
      </div>
      <PudyOrb state={state} size="small" />
      <p className="pudle-assistant-answer" aria-live="polite"><strong>Grounded in current displayed data:</strong> {answer}</p>
      <div className="pudle-assistant-controls">
        <PudleButton variant="secondary" disabled={!enabled} onClick={voiceEnabled ? stopVoice : enableVoice}>
          {voiceEnabled ? 'Stop voice' : 'Enable voice'}
        </PudleButton>
        <form onSubmit={(event) => { event.preventDefault(); if (text.trim()) void process(text, false); }}>
          <label className="pudle-field">
            <span>Tap-to-talk alternative</span>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What is visible?" disabled={!enabled} />
          </label>
          <PudleButton type="submit" disabled={!enabled || !text.trim()}>Ask</PudleButton>
        </form>
      </div>
      <p className="pudle-disclosure">
        {speechSupported
          ? 'After Enable voice, foreground recognition listens across utterances for “Hey Pudy” only while this page is visible. It stops during Pudy’s reply. Your browser vendor may process microphone audio; background and locked-phone wake are not supported.'
          : 'Speech recognition is unavailable here. Text questions remain local and available.'}
      </p>
    </section>
  );
});
