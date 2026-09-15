import { describe, expect, it } from 'vitest';
import { BrowserRecorder } from './recorder';

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true;
  readonly mimeType: string;
  state: RecordingState = 'inactive';

  constructor(
    _stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? 'video/webm';
  }

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    const dataEvent = new Event('dataavailable') as BlobEvent;
    Object.defineProperty(dataEvent, 'data', {
      value: new Blob(['video'], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }
}

describe('BrowserRecorder', () => {
  it('runs honest start, pause, resume, and stop transitions', async () => {
    let now = 100;
    const states: string[] = [];
    const recorder = new BrowserRecorder({} as MediaStream, {
      MediaRecorderClass:
        FakeMediaRecorder as unknown as typeof MediaRecorder,
      now: () => now,
      onStateChange: (state) => states.push(state),
    });

    recorder.start();
    now = 1_100;
    recorder.pause();
    now = 2_100;
    recorder.resume();
    now = 3_100;
    const result = await recorder.stop();

    expect(states).toEqual([
      'recording',
      'paused',
      'recording',
      'stopping',
      'stopped',
    ]);
    expect(result.durationMs).toBe(2_000);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('preserves partial media and marks an interrupted recording', async () => {
    const states: string[] = [];
    const recorder = new BrowserRecorder({} as MediaStream, {
      MediaRecorderClass:
        FakeMediaRecorder as unknown as typeof MediaRecorder,
      onStateChange: (state) => states.push(state),
    });

    recorder.start();
    const result = await recorder.interrupt();

    expect(result?.blob.size).toBeGreaterThan(0);
    expect(states.at(-1)).toBe('interrupted');
    expect(recorder.state).toBe('interrupted');
  });

  it('rejects invalid transitions', () => {
    const recorder = new BrowserRecorder({} as MediaStream, {
      MediaRecorderClass:
        FakeMediaRecorder as unknown as typeof MediaRecorder,
    });

    expect(() => recorder.pause()).toThrow(/Cannot pause/);
  });
});
