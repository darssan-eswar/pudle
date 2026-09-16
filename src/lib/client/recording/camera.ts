import { RecordingError } from './types';

export interface CameraSession {
  readonly stream: MediaStream;
  readonly interrupted: Promise<void>;
  stop(): void;
}

export interface CameraOptions {
  mediaDevices?: MediaDevices;
  onInterrupted?: () => void;
  video?: MediaTrackConstraints;
}

function cameraError(error: unknown): RecordingError {
  const name = error instanceof DOMException ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new RecordingError(
      'permission-denied',
      'Camera permission was denied. Allow camera access and try again.',
      { cause: error },
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new RecordingError(
      'device-missing',
      'No camera is available on this device.',
      { cause: error },
    );
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new RecordingError(
      'device-busy',
      'The camera is unavailable or already in use.',
      { cause: error },
    );
  }
  return new RecordingError('unsupported', 'The camera could not be started.', {
    cause: error,
  });
}

function supportedVideoConstraints(
  mediaDevices: MediaDevices,
  overrides: MediaTrackConstraints = {},
): MediaTrackConstraints {
  const supported = mediaDevices.getSupportedConstraints?.() ?? {};
  const constraints: MediaTrackConstraints = { ...overrides };

  if (supported.facingMode && overrides.facingMode === undefined) {
    constraints.facingMode = { ideal: 'environment' };
  }
  if (supported.width && overrides.width === undefined) {
    constraints.width = { ideal: 1920 };
  }
  if (supported.height && overrides.height === undefined) {
    constraints.height = { ideal: 1080 };
  }

  return constraints;
}

export async function acquireRearCamera(
  options: CameraOptions = {},
): Promise<CameraSession> {
  const mediaDevices =
    options.mediaDevices ??
    (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices);
  if (!mediaDevices?.getUserMedia) {
    throw new RecordingError(
      'unsupported',
      'Camera capture is not supported in this browser.',
    );
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: false,
      video: supportedVideoConstraints(mediaDevices, options.video),
    });
  } catch (error) {
    throw cameraError(error);
  }

  const tracks = stream.getTracks();
  let stoppedIntentionally = false;
  let resolveInterrupted: (() => void) | undefined;
  const interrupted = new Promise<void>((resolve) => {
    resolveInterrupted = resolve;
  });

  const handleEnded = () => {
    if (!stoppedIntentionally) {
      options.onInterrupted?.();
      resolveInterrupted?.();
    }
  };
  tracks.forEach((track) => track.addEventListener('ended', handleEnded));

  return {
    stream,
    interrupted,
    stop() {
      stoppedIntentionally = true;
      tracks.forEach((track) => {
        track.removeEventListener('ended', handleEnded);
        track.stop();
      });
    },
  };
}
