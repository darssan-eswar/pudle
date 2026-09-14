export const RECORDING_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function selectRecordingMimeType(
  recorder: Pick<typeof MediaRecorder, 'isTypeSupported'> | undefined =
    typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
  candidates: readonly string[] = RECORDING_MIME_CANDIDATES,
): string | undefined {
  if (!recorder?.isTypeSupported) {
    return undefined;
  }

  return candidates.find((candidate) => recorder.isTypeSupported(candidate));
}
