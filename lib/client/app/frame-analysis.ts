export const CLOUD_FRAME_MAX_BYTES = 512 * 1024;
export const CLOUD_FRAME_MIN_INTERVAL_MS = 5_000;

export async function captureCompressedFrame(
  video: HTMLVideoElement,
): Promise<{ blob: Blob; capturedAt: number }> {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw new Error('A current camera or replay frame is not available.');
  }
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Frame compression is unavailable.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  for (const mimeType of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of [0.72, 0.58, 0.44, 0.3]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mimeType, quality),
      );
      if (blob && blob.size > 0 && blob.size <= CLOUD_FRAME_MAX_BYTES) {
        return { blob, capturedAt: Date.now() };
      }
    }
  }
  throw new Error('The compressed frame is larger than 512 KB.');
}

export class CloudFrameController {
  private enabled = false;
  private active?: AbortController;
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly task: (signal: AbortSignal, capturedAt: number) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly minimumIntervalMs = CLOUD_FRAME_MIN_INTERVAL_MS,
  ) {}

  enable(): void {
    this.enabled = true;
  }

  async tick(): Promise<boolean> {
    const timestamp = this.now();
    if (
      !this.enabled ||
      this.active ||
      timestamp - this.lastStartedAt < this.minimumIntervalMs
    ) {
      return false;
    }
    this.lastStartedAt = timestamp;
    const controller = new AbortController();
    this.active = controller;
    try {
      await this.task(controller.signal, timestamp);
      return true;
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  }
  disable(): void {
    this.enabled = false;
    this.active?.abort();
    this.active = undefined;
  }
}
