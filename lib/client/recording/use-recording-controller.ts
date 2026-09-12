'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingAccountSession } from './account-session';
import { acquireRearCamera, type CameraSession } from './camera';
import {
  BrowserRecorder,
  type CompletedRecording,
} from './recorder';
import {
  RecordingError,
  type RecordingCallbacks,
  type RecordingEvent,
  type RecordingMetadataChange,
  type RecordingState,
} from './types';

export interface UseRecordingControllerOptions extends RecordingCallbacks {
  account: RecordingAccountSession;
}

export interface RecordingControllerApi {
  state: RecordingState;
  stream?: MediaStream;
  elapsedMs: number;
  error?: RecordingError;
  acquireCamera(): Promise<void>;
  releaseCamera(): void;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  dispose(): void;
  reset(): void;
  clearError(): void;
}

function normalizeError(error: unknown): RecordingError {
  return error instanceof RecordingError
    ? error
    : new RecordingError('unsupported', 'Recording failed unexpectedly.', {
        cause: error,
      });
}

export function useRecordingController(
  options: UseRecordingControllerOptions,
): RecordingControllerApi {
  const [state, setState] = useState<RecordingState>('idle');
  const [stream, setStream] = useState<MediaStream>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecordingError>();
  const mounted = useRef(true);
  const session = useRef<CameraSession | undefined>(undefined);
  const recorder = useRef<BrowserRecorder | undefined>(undefined);
  const acquisitionGeneration = useRef(0);
  const pendingAcquisition = useRef<Promise<void> | undefined>(undefined);
  const callbacks = useRef<RecordingCallbacks>(options);

  useEffect(() => {
    callbacks.current = options;
  }, [options]);

  const emit = useCallback((event: RecordingEvent) => {
    callbacks.current.onEvent?.(event);
  }, []);

  const updateState = useCallback(
    (nextState: RecordingState) => {
      if (mounted.current) {
        setState(nextState);
      }
      emit({ type: 'state-change', state: nextState });
    },
    [emit],
  );

  const reportError = useCallback(
    (caught: unknown) => {
      const nextError = normalizeError(caught);
      if (mounted.current) {
        setError(nextError);
      }
      updateState('error');
      emit({ type: 'error', error: nextError });
    },
    [emit, updateState],
  );

  const notifyMetadata = useCallback(
    (change: RecordingMetadataChange) => {
      try {
        const result = callbacks.current.onMetadataChange?.(change);
        void Promise.resolve(result).catch((syncError) => {
          emit({ type: 'metadata-sync-error', change, error: syncError });
        });
      } catch (syncError) {
        emit({ type: 'metadata-sync-error', change, error: syncError });
      }
    },
    [emit],
  );

  const saveCompleted = useCallback(
    async (completed: CompletedRecording) => {
      const result = await options.account.storage.save({
        blob: completed.blob,
        durationMs: completed.durationMs,
      });
      emit({ type: 'recording-saved', metadata: result.metadata });
      notifyMetadata({ action: 'saved', metadata: result.metadata });
      for (const id of result.removedIds) {
        emit({ type: 'recording-deleted', id });
        notifyMetadata({ action: 'deleted', id });
      }
    },
    [emit, notifyMetadata, options.account],
  );

  const invalidatePendingAcquisition = useCallback(() => {
    acquisitionGeneration.current += 1;
    pendingAcquisition.current = undefined;
  }, []);

  const disposeCapture = useCallback(() => {
    invalidatePendingAcquisition();
    recorder.current?.dispose();
    recorder.current = undefined;
    session.current?.stop();
    session.current = undefined;
  }, [invalidatePendingAcquisition]);

  const handleInterruption = useCallback(async () => {
    updateState('interrupted');
    emit({ type: 'stream-interrupted' });
    setStream(undefined);
    const interruptedSession = session.current;
    session.current = undefined;
    interruptedSession?.stop();
    try {
      const completed = await recorder.current?.interrupt();
      if (completed?.blob.size) {
        await saveCompleted(completed);
      }
    } catch (caught) {
      recorder.current?.dispose();
      recorder.current = undefined;
      reportError(caught);
    }
  }, [emit, reportError, saveCompleted, updateState]);

  const acquireCamera = useCallback((): Promise<void> => {
    if (session.current) {
      return Promise.resolve();
    }
    if (pendingAcquisition.current) {
      return pendingAcquisition.current;
    }

    const generation = acquisitionGeneration.current;
    setError(undefined);
    updateState('acquiring');

    const request = (async () => {
      try {
        const acquired = await acquireRearCamera({
          onInterrupted: () => void handleInterruption(),
        });
        if (
          !mounted.current ||
          generation !== acquisitionGeneration.current
        ) {
          acquired.stop();
          return;
        }
        session.current = acquired;
        recorder.current = new BrowserRecorder(acquired.stream, {
          onElapsed: setElapsedMs,
          onStateChange: updateState,
        });
        setStream(acquired.stream);
        updateState('ready');
        emit({ type: 'stream-ready', stream: acquired.stream });
      } catch (caught) {
        if (
          !mounted.current ||
          generation !== acquisitionGeneration.current
        ) {
          return;
        }
        session.current?.stop();
        session.current = undefined;
        recorder.current?.dispose();
        recorder.current = undefined;
        setStream(undefined);
        reportError(caught);
      } finally {
        if (generation === acquisitionGeneration.current) {
          pendingAcquisition.current = undefined;
        }
      }
    })();
    pendingAcquisition.current = request;
    return request;
  }, [emit, handleInterruption, reportError, updateState]);

  const releaseCamera = useCallback(() => {
    disposeCapture();
    setStream(undefined);
    setElapsedMs(0);
    updateState('idle');
  }, [disposeCapture, updateState]);

  const dispose = useCallback(() => {
    options.account.dispose();
    setStream(undefined);
    setElapsedMs(0);
    setError(undefined);
    updateState('idle');
  }, [options.account, updateState]);

  const start = useCallback(() => {
    setError(undefined);
    setElapsedMs(0);
    try {
      recorder.current?.start();
      if (!recorder.current) {
        throw new RecordingError(
          'invalid-state',
          'Start the camera before recording.',
        );
      }
    } catch (caught) {
      reportError(caught);
    }
  }, [reportError]);

  const pause = useCallback(() => {
    try {
      recorder.current?.pause();
    } catch (caught) {
      reportError(caught);
    }
  }, [reportError]);

  const resume = useCallback(() => {
    try {
      recorder.current?.resume();
    } catch (caught) {
      reportError(caught);
    }
  }, [reportError]);

  const stop = useCallback(async () => {
    try {
      const completed = await recorder.current?.stop();
      if (!completed) {
        throw new RecordingError('invalid-state', 'No recording is active.');
      }
      await saveCompleted(completed);
    } catch (caught) {
      reportError(caught);
    }
  }, [reportError, saveCompleted]);

  useEffect(() => {
    mounted.current = true;
    const unregister = options.account.registerCleanup(disposeCapture);
    return () => {
      mounted.current = false;
      unregister();
      disposeCapture();
    };
  }, [disposeCapture, options.account]);

  return {
    state,
    stream,
    elapsedMs,
    error,
    acquireCamera,
    releaseCamera,
    start,
    pause,
    resume,
    stop,
    dispose,
    reset: dispose,
    clearError: () => setError(undefined),
  };
}
