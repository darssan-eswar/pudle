import {
  SMOLVLM_MAX_INPUT_DIMENSION,
  type SmolVlmFrame,
} from './smolvlm-contract';

export function captureSmolVlmFrame(
  video: HTMLVideoElement,
  capturedAt = Date.now(),
): SmolVlmFrame {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    || !video.videoWidth
    || !video.videoHeight
  ) {
    throw new Error('Wait for a current camera frame before describing it.');
  }

  const scale = Math.min(
    1,
    SMOLVLM_MAX_INPUT_DIMENSION / Math.max(video.videoWidth, video.videoHeight),
  );
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) {
    throw new Error('This browser cannot capture a local model frame.');
  }
  context.drawImage(video, 0, 0, width, height);
  const pixels = new Uint8ClampedArray(
    context.getImageData(0, 0, width, height).data,
  );
  canvas.width = 1;
  canvas.height = 1;
  return { pixels, width, height, capturedAt };
}
