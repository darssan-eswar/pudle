'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireRearCamera, type CameraSession } from './camera';
import {
  BrowserRecorder,
  type CompletedRecording,
} from './recorder';
import {
  PrivateRecordingStorage,
  type RecordingStorageOptions,
} from './storage';
import {
  RecordingError,
  type RecordingCallbacks,
  type RecordingEvent,
  type RecordingMetadataChange,
  type RecordingState,
} from './types';

export interface UseRecordingControllerOptions extends RecordingCallbacks {
  storage?: PrivateRecordingStorage;
  storageOptions?: RecordingStorageOptions;
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
  options: UseRecordingControllerOptions = {},
): RecordingControllerApi {
  const [state, setState] = useState<RecordingState>('idle');
  const [stream, setStream] = useState<MediaStream>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecordingError>();
  const mounted = useRef(true);
  const session = useRef<CameraSession | undefined>(undefined);
  const recorder = useRef<BrowserRecorder | undefined>(undefined);
  const storage = useRef<PrivateRecordingStorage | undefined>(undefined);
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

  const getStorage = useCallback(() => {
    storage.current ??=
      options.storage ?? new PrivateRecordingStorage(options.storageOptions);
    return storage.current;
  }, [options.storage, options.storageOptions]);

  const saveCompleted = useCallback(
    async (completed: CompletedRecording) => {
      const result = await getStorage().save({
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
    [emit, getStorage, notifyMetadata],
  );

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

  const acquireCamera = useCallback(async () => {
    if (session.current) {
      return;
    }
    setError(undefined);
    updateState('acquiring');
    try {
      const acquired = await acquireRearCamera({
        onInterrupted: () => void handleInterruption(),
      });
      if (!mounted.current) {
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
      session.current?.stop();
      session.current = undefined;
      recorder.current?.dispose();
      recorder.current = undefined;
      setStream(undefined);
      reportError(caught);
    }
  }, [emit, handleInterruption, reportError, updateState]);

  const releaseCamera = useCallback(() => {
    recorder.current?.dispose();
    recorder.current = undefined;
    session.current?.stop();
    session.current = undefined;
    setStream(undefined);
    setElapsedMs(0);
    updateState('idle');
  }, [updateState]);

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
    return () => {
      mounted.current = false;
      recorder.current?.dispose();
      session.current?.stop();
      if (!options.storage) {
        storage.current?.close();
      }
    };
  }, [options.storage]);

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
    clearError: () => setError(undefined),
  };
}
