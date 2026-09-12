import { describe, expect, it } from 'vitest';
import {
  RECORDING_MIME_CANDIDATES,
  selectRecordingMimeType,
} from './mime';

describe('selectRecordingMimeType', () => {
  it('selects the first browser-supported candidate', () => {
    const supported = RECORDING_MIME_CANDIDATES[2];
    const recorder = {
      isTypeSupported: (mimeType: string) => mimeType === supported,
    } as unknown as typeof MediaRecorder;

    expect(selectRecordingMimeType(recorder)).toBe(supported);
  });

  it('allows the browser to choose when capability detection is unavailable', () => {
    expect(selectRecordingMimeType(undefined)).toBeUndefined();
  });
});
