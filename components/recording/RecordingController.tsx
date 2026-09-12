'use client';

import { useEffect, useId, useRef } from 'react';
import {
  useRecordingController,
  type UseRecordingControllerOptions,
} from '@/lib/client/recording/use-recording-controller';
import styles from './recording.module.css';

export interface RecordingControllerProps extends UseRecordingControllerOptions {
  className?: string;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function RecordingController({
  className,
  ...options
}: RecordingControllerProps) {
  const controller = useRecordingController(options);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = controller.stream ?? null;
    }
  }, [controller.stream]);

  const active =
    controller.state === 'recording' || controller.state === 'paused';

  return (
    <section
      className={[styles.stack, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>Private recording</h2>
      <video
        ref={videoRef}
        className={styles.preview}
        autoPlay
        muted
        playsInline
        aria-label="Rear camera preview"
      />
      <p className={styles.status} role="status" aria-live="polite">
        {active
          ? `${controller.state === 'paused' ? 'Paused' : 'Recording'} ${formatElapsed(controller.elapsedMs)}`
          : `Camera status: ${controller.state}`}
      </p>
      <p className={styles.message}>
        Recordings stay stored on this device unless you export them.
      </p>
      {controller.error ? (
        <p className={styles.error} role="alert">
          {controller.error.message}
        </p>
      ) : null}
      <div className={styles.controls}>
        {controller.state === 'idle' ||
        controller.state === 'error' ||
        controller.state === 'interrupted' ? (
          <button
            className={styles.button}
            type="button"
            onClick={() => void controller.acquireCamera()}
          >
            Start camera
          </button>
        ) : null}
        {controller.state === 'ready' || controller.state === 'stopped' ? (
          <button
            className={styles.button}
            type="button"
            onClick={controller.start}
          >
            Record
          </button>
        ) : null}
        {controller.state === 'recording' ? (
          <button
            className={styles.button}
            type="button"
            onClick={controller.pause}
          >
            Pause
          </button>
        ) : null}
        {controller.state === 'paused' ? (
          <button
            className={styles.button}
            type="button"
            onClick={controller.resume}
          >
            Resume
          </button>
        ) : null}
        {active ? (
          <button
            className={`${styles.button} ${styles.danger}`}
            type="button"
            onClick={() => void controller.stop()}
          >
            Stop and save
          </button>
        ) : null}
        {controller.stream && !active ? (
          <button
            className={styles.button}
            type="button"
            onClick={controller.releaseCamera}
          >
            Turn off camera
          </button>
        ) : null}
      </div>
    </section>
  );
}
