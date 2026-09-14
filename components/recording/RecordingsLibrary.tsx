'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  RecordingError,
  type RecordingAccountSession,
  type RecordingCallbacks,
  type RecordingMetadata,
} from '@/lib/client/recording';
import styles from './recording.module.css';

export interface RecordingsLibraryProps extends RecordingCallbacks {
  account: RecordingAccountSession;
  className?: string;
  confirmDelete?: (recording: RecordingMetadata) => boolean | Promise<boolean>;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}

function fileExtension(mimeType: string): string {
  return mimeType.includes('webm') ? 'webm' : 'mp4';
}

export function RecordingsLibrary({
  account,
  ...props
}: RecordingsLibraryProps) {
  return (
    <RecordingsLibraryView
      key={account.ownerId}
      account={account}
      {...props}
    />
  );
}

function RecordingsLibraryView({
  account,
  className,
  confirmDelete,
  onEvent,
  onMetadataChange,
}: RecordingsLibraryProps) {
  const storage = account.storage;
  const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<RecordingMetadata>();
  const playbackUrlRef = useRef<string | undefined>(undefined);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setRecordings(await storage.list());
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Recordings could not be loaded.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    let active = true;
    storage
      .list()
      .then((items) => {
        if (active) {
          setRecordings(items);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Recordings could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [storage]);

  useEffect(() => {
    playbackUrlRef.current = playbackUrl;
  }, [playbackUrl]);

  useEffect(() => {
    const cleanup = () => {
      if (playbackUrlRef.current) {
        account.revokeObjectUrl(playbackUrlRef.current);
        playbackUrlRef.current = undefined;
      }
    };
    const unregister = account.registerCleanup(cleanup);
    return () => {
      unregister();
      cleanup();
    };
  }, [account]);

  const loadBlob = async (id: string) => {
    const recording = await storage.load(id);
    if (!recording) {
      throw new RecordingError(
        'storage-failed',
        'This recording is no longer stored on this device.',
      );
    }
    return recording;
  };

  const play = async (id: string) => {
    setError(undefined);
    try {
      const recording = await loadBlob(id);
      if (playbackUrl) {
        account.revokeObjectUrl(playbackUrl);
      }
      setPlaybackUrl(account.createObjectUrl(recording.blob));
      setSelectedId(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Playback failed.');
    }
  };

  const exportRecording = async (metadata: RecordingMetadata) => {
    setError(undefined);
    try {
      const recording = await loadBlob(metadata.id);
      const url = account.createObjectUrl(recording.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pudle-${new Date(metadata.createdAt)
        .toISOString()
        .replaceAll(':', '-')}.${fileExtension(metadata.mimeType)}`;
      anchor.click();
      setTimeout(() => account.revokeObjectUrl(url), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed.');
    }
  };

  const deleteRecording = async (metadata: RecordingMetadata) => {
    setError(undefined);
    try {
      await storage.delete(metadata.id);
      if (selectedId === metadata.id) {
        if (playbackUrl) {
          account.revokeObjectUrl(playbackUrl);
        }
        setPlaybackUrl(undefined);
        setSelectedId(undefined);
      }
      setRecordings((current) =>
        current.filter((recording) => recording.id !== metadata.id),
      );
      const change = { action: 'deleted' as const, id: metadata.id };
      onEvent?.({ type: 'recording-deleted', id: metadata.id });
      try {
        await onMetadataChange?.(change);
      } catch (syncError) {
        onEvent?.({
          type: 'metadata-sync-error',
          change,
          error: syncError,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.');
    }
  };

  const requestDelete = async (
    metadata: RecordingMetadata,
    trigger: HTMLButtonElement,
  ) => {
    if (confirmDelete) {
      if (await confirmDelete(metadata)) await deleteRecording(metadata);
      return;
    }
    deleteTriggerRef.current = trigger;
    setPendingDelete(metadata);
    queueMicrotask(() => cancelDeleteRef.current?.focus());
  };

  const cancelDelete = () => {
    setPendingDelete(undefined);
    queueMicrotask(() => deleteTriggerRef.current?.focus());
  };

  return (
    <section
      className={[styles.stack, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>Recordings on this device</h2>
      <p className={styles.message}>
        These videos are stored privately on this device and are never uploaded
        by this library.
      </p>
      {loading ? (
        <p role="status">Loading recordings…</p>
      ) : error ? (
        <div role="alert" className={styles.stack}>
          <p className={styles.error}>{error}</p>
          <button
            className={styles.button}
            type="button"
            onClick={() => void loadLibrary()}
          >
            Try again
          </button>
        </div>
      ) : recordings.length === 0 ? (
        <p role="status">No recordings are stored on this device.</p>
      ) : (
        <ul className={styles.library}>
          {recordings.map((recording) => (
            <li className={styles.card} key={recording.id}>
              <h3>{recording.name}</h3>
              <p>
                {new Date(recording.createdAt).toLocaleString()} ·{' '}
                {formatDuration(recording.durationMs)} ·{' '}
                {(recording.size / 1_000_000).toFixed(1)} MB
              </p>
              {selectedId === recording.id && playbackUrl ? (
                <video
                  className={styles.player}
                  controls
                  playsInline
                  src={playbackUrl}
                  aria-label={`Playback of ${recording.name}`}
                />
              ) : null}
              <div className={styles.controls}>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void play(recording.id)}
                >
                  Play
                </button>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void exportRecording(recording)}
                >
                  Export
                </button>
                <button
                  className={`${styles.button} ${styles.danger}`}
                  type="button"
                  onClick={(event) => void requestDelete(recording, event.currentTarget)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pendingDelete ? (
        <div className={styles.dialogBackdrop}>
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            aria-describedby={deleteDescriptionId}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelDelete();
            }}
          >
            <h3 id={deleteTitleId}>Delete this recording?</h3>
            <p id={deleteDescriptionId}>
              “{pendingDelete.name}” will be removed from this device. This cannot be undone.
            </p>
            <div className={styles.controls}>
              <button
                ref={cancelDeleteRef}
                className={styles.button}
                type="button"
                onClick={cancelDelete}
              >
                Keep recording
              </button>
              <button
                className={`${styles.button} ${styles.danger}`}
                type="button"
                onClick={() => {
                  const recording = pendingDelete;
                  setPendingDelete(undefined);
                  void deleteRecording(recording);
                }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
