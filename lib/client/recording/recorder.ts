import { selectRecordingMimeType } from './mime';
import { RecordingError, type RecordingState } from './types';

export interface CompletedRecording {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface BrowserRecorderOptions {
  MediaRecorderClass?: typeof MediaRecorder;
  mimeCandidates?: readonly string[];
  now?: () => number;
  onElapsed?: (elapsedMs: number) => void;
  onStateChange?: (state: RecordingState) => void;
  tickMs?: number;
}

export class BrowserRecorder {
  private readonly RecorderClass: typeof MediaRecorder;
  private readonly now: () => number;
  private readonly onElapsed?: (elapsedMs: number) => void;
  private readonly onStateChange?: (state: RecordingState) => void;
  private readonly tickMs: number;
  private readonly mimeType?: string;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedDuration = 0;
  private timer?: ReturnType<typeof setInterval>;
  private pendingStop?: {
    resolve: (result: CompletedRecording) => void;
    reject: (error: RecordingError) => void;
  };

  state: RecordingState = 'ready';

  constructor(
    private readonly stream: MediaStream,
    options: BrowserRecorderOptions = {},
  ) {
    const RecorderClass =
      options.MediaRecorderClass ??
      (typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder);
    if (!RecorderClass) {
      throw new RecordingError(
        'unsupported',
        'Video recording is not supported in this browser.',
      );
    }
    this.RecorderClass = RecorderClass;
    this.mimeType = selectRecordingMimeType(
      RecorderClass,
      options.mimeCandidates,
    );
    this.now = options.now ?? (() => performance.now());
    this.onElapsed = options.onElapsed;
    this.onStateChange = options.onStateChange;
    this.tickMs = options.tickMs ?? 250;
  }

  start(timesliceMs = 1_000): void {
    if (this.state !== 'ready' && this.state !== 'stopped') {
      throw this.invalidState('start');
    }

    this.chunks = [];
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.startedAt = this.now();
    this.recorder = new this.RecorderClass(
      this.stream,
      this.mimeType ? { mimeType: this.mimeType } : undefined,
    );
    this.recorder.addEventListener('dataavailable', this.handleData);
    this.recorder.addEventListener('stop', this.handleStop);
    this.recorder.addEventListener('error', this.handleError);
    this.recorder.start(timesliceMs);
    this.setState('recording');
    this.timer = setInterval(() => this.emitElapsed(), this.tickMs);
  }

  pause(): void {
    if (this.state !== 'recording' || !this.recorder) {
      throw this.invalidState('pause');
    }
    this.recorder.pause();
    this.pausedAt = this.now();
    this.setState('paused');
    this.emitElapsed();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.recorder) {
      throw this.invalidState('resume');
    }
    this.pausedDuration += this.now() - this.pausedAt;
    this.pausedAt = 0;
    this.recorder.resume();
    this.setState('recording');
  }

  stop(): Promise<CompletedRecording> {
    if (
      (this.state !== 'recording' && this.state !== 'paused') ||
      !this.recorder
    ) {
      return Promise.reject(this.invalidState('stop'));
    }

    if (this.state === 'paused') {
      this.pausedDuration += this.now() - this.pausedAt;
      this.pausedAt = 0;
    }
    this.setState('stopping');
    this.clearTimer();

    const result = new Promise<CompletedRecording>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
    });
    this.recorder.stop();
    return result;
  }

  interrupt(): Promise<CompletedRecording | undefined> {
    if (this.state === 'recording' || this.state === 'paused') {
      const result = this.stop();
      this.setState('interrupted');
      return result;
    }
    this.clearTimer();
    this.setState('interrupted');
    return Promise.resolve(undefined);
  }

  dispose(): void {
    this.clearTimer();
    if (
      this.recorder &&
      (this.recorder.state === 'recording' || this.recorder.state === 'paused')
    ) {
      this.recorder.stop();
    }
    this.detachRecorder();
  }

  private elapsed(): number {
    const end = this.pausedAt || this.now();
    return Math.max(0, end - this.startedAt - this.pausedDuration);
  }

  private emitElapsed(): void {
    this.onElapsed?.(this.elapsed());
  }

  private setState(state: RecordingState): void {
    this.state = state;
    this.onStateChange?.(state);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private readonly handleData = (event: BlobEvent): void => {
    if (event.data.size > 0) {
      this.chunks.push(event.data);
    }
  };

  private readonly handleStop = (): void => {
    const durationMs = this.elapsed();
    const mimeType =
      this.recorder?.mimeType || this.mimeType || this.chunks[0]?.type || 'video/mp4';
    const result = {
      blob: new Blob(this.chunks, { type: mimeType }),
      durationMs,
      mimeType,
    };
    const terminalState =
      this.state === 'interrupted' ? 'interrupted' : 'stopped';
    this.clearTimer();
    this.detachRecorder();
    this.setState(terminalState);
    this.onElapsed?.(durationMs);
    this.pendingStop?.resolve(result);
    this.pendingStop = undefined;
  };

  private readonly handleError = (event: Event): void => {
    const error = new RecordingError(
      'unsupported',
      'The browser stopped recording unexpectedly.',
      { cause: event },
    );
    this.clearTimer();
    this.detachRecorder();
    this.setState('error');
    this.pendingStop?.reject(error);
    this.pendingStop = undefined;
  };

  private detachRecorder(): void {
    this.recorder?.removeEventListener('dataavailable', this.handleData);
    this.recorder?.removeEventListener('stop', this.handleStop);
    this.recorder?.removeEventListener('error', this.handleError);
  }

  private invalidState(action: string): RecordingError {
    return new RecordingError(
      'invalid-state',
      `Cannot ${action} while the recorder is ${this.state}.`,
    );
  }
}
