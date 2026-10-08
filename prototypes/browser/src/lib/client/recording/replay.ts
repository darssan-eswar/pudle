import { RecordingError } from './types';

export const DEFAULT_MAX_REPLAY_BYTES = 1_000_000_000;

export interface ReplayInput {
  readonly file: File;
  readonly url: string;
  revoke(): void;
}

export interface ReplayInputOptions {
  maxBytes?: number;
  urlApi?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export function createReplayInput(
  file: File,
  options: ReplayInputOptions = {},
): ReplayInput {
  if (!file.type.toLowerCase().startsWith('video/')) {
    throw new RecordingError(
      'invalid-file',
      'Choose a local video file to replay.',
    );
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REPLAY_BYTES;
  if (file.size === 0) {
    throw new RecordingError('invalid-file', 'The selected video is empty.');
  }
  if (file.size > maxBytes) {
    throw new RecordingError(
      'file-too-large',
      `The selected video must be ${Math.floor(maxBytes / 1_000_000)} MB or smaller.`,
    );
  }

  const urlApi = options.urlApi ?? URL;
  const url = urlApi.createObjectURL(file);
  let revoked = false;

  return {
    file,
    url,
    revoke() {
      if (!revoked) {
        urlApi.revokeObjectURL(url);
        revoked = true;
      }
    },
  };
}
