import { describe, expect, it, vi } from 'vitest';
import { createCocoSsdAdapter } from './coco-ssd-adapter';

describe('COCO-SSD local model adapter', () => {
  it('returns only bounded validated local observations and disposes the model', async () => {
    const dispose = vi.fn();
    const detect = vi.fn(async () => [
      { class: 'car', score: 0.91 },
      { class: ' person ', score: 0.72 },
      { class: 'low', score: 0.59 },
      { class: '', score: 0.99 },
      { class: 'invalid', score: Number.NaN },
      { class: 'truck', score: 0.8 },
      { class: 'bus', score: 0.7 },
      { class: 'bicycle', score: 0.65 },
    ]);
    const model = createCocoSsdAdapter(async () => ({ detect, dispose }));
    const controller = new AbortController();
    await model.load(controller.signal);
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 },
      readyState: { configurable: true, value: 4 },
    });

    await expect(model.infer(video, controller.signal)).resolves.toEqual([
      { label: 'car', confidence: 0.91 },
      { label: 'person', confidence: 0.72 },
      { label: 'truck', confidence: 0.8 },
      { label: 'bus', confidence: 0.7 },
    ]);
    expect(detect).toHaveBeenCalledExactlyOnceWith(video);
    model.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects unavailable frames before invoking the detector', async () => {
    const detect = vi.fn(async () => []);
    const model = createCocoSsdAdapter(async () => ({ detect }));
    const controller = new AbortController();
    await model.load(controller.signal);

    await expect(
      model.infer(document.createElement('video'), controller.signal),
    ).rejects.toThrow('A current camera frame is not available.');
    expect(detect).not.toHaveBeenCalled();
  });
});
