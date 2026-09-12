'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PudleButton, PudleStatusBadge, PudyOrb, type PudyState } from '@/components/pudle';
import { groundPudyAnswer, parsePudyRequest, type PudyAction } from '@/lib/client/app';

interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
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
  const mounted = useRef(true);
  const generation = useRef(0);
  const [state, setState] = useState<PudyState>('idle');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('Ask about only what Pudle currently displays.');
  const [speechSupported, setSpeechSupported] = useState(false);

  const stopSpeech = useCallback(() => {
    generation.current += 1;
    recognition.current?.abort();
    recognition.current = undefined;
    window.speechSynthesis?.cancel();
    if (mounted.current) setState('idle');
  }, []);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    if (!enabled) stopSpeech();
  }, [enabled, stopSpeech]);

  useEffect(() => {
    mounted.current = true;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopSpeech();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      stopSpeech();
    };
  }, [stopSpeech]);

  useImperativeHandle(ref, () => ({ stop: stopSpeech }), [stopSpeech]);

  const speak = useCallback((message: string, requestGeneration: number) => {
    if (!mounted.current || requestGeneration !== generation.current) return;
    recognition.current?.stop();
    recognition.current = undefined;
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setState('idle');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.onend = () => {
      if (mounted.current && requestGeneration === generation.current) setState('idle');
    };
    utterance.onerror = () => {
      if (mounted.current && requestGeneration === generation.current) setState('error');
    };
    setState('speaking');
    window.speechSynthesis.speak(utterance);
  }, []);

  const process = useCallback(async (input: string, requireWakePhrase: boolean) => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setState('thinking');
    const request = parsePudyRequest(input, requireWakePhrase);
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
        setAnswer('Pudy could not complete that action. Nothing was shared or saved.');
        setState('error');
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

  function listen() {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setAnswer('Speech recognition is unavailable. Type your request below.');
      setState('error');
      return;
    }
    stopSpeech();
    const listenGeneration = generation.current;
    const next = new Recognition();
    next.continuous = false;
    next.interimResults = false;
    next.lang = navigator.language || 'en-US';
    next.onresult = (event) => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      void process(event.results[0]?.[0]?.transcript ?? '', true);
    };
    next.onerror = () => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      recognition.current = undefined;
      setAnswer('Listening stopped. Check microphone permission or use text.');
      setState('error');
    };
    next.onend = () => {
      if (recognition.current !== next || listenGeneration !== generation.current) return;
      recognition.current = undefined;
      setState((current) => current === 'listening' ? 'idle' : current);
    };
    recognition.current = next;
    setState('listening');
    try {
      next.start();
    } catch {
      if (recognition.current === next && listenGeneration === generation.current) {
        recognition.current = undefined;
        setAnswer('Listening could not start. Check microphone permission or use text.');
        setState('error');
      }
    }
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
        <PudleButton variant="secondary" disabled={!enabled} onClick={state === 'listening' ? stopSpeech : listen}>
          {state === 'listening' ? 'Stop listening' : 'Listen for “Hey Pudy”'}
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
          ? 'Browser speech recognition may send microphone audio to your browser vendor’s cloud. It runs only after you tap Listen and is stopped before speech playback.'
          : 'Speech recognition is unavailable here. Text questions remain local and available.'}
      </p>
    </section>
  );
});
