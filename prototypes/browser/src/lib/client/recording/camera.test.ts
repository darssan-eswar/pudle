import { describe, expect, it, vi } from 'vitest';
import { acquireRearCamera } from './camera';

class FakeTrack extends EventTarget {
  stop = vi.fn(() => this.dispatchEvent(new Event('ended')));
}

function fakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe('acquireRearCamera', () => {
  it('requests a supported rear camera without audio', async () => {
    const track = new FakeTrack();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream(track));
    const mediaDevices = {
      getSupportedConstraints: () => ({
        facingMode: true,
        width: true,
        height: true,
      }),
      getUserMedia,
    } as unknown as MediaDevices;

    const session = await acquireRearCamera({ mediaDevices });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        height: { ideal: 1080 },
        width: { ideal: 1920 },
      },
    });
    session.stop();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('reports an unexpected track interruption but not intentional cleanup', async () => {
    const interrupted = vi.fn();
    const interruptedTrack = new FakeTrack();
    const interruptedSession = await acquireRearCamera({
      mediaDevices: {
        getSupportedConstraints: () => ({}),
        getUserMedia: vi.fn().mockResolvedValue(fakeStream(interruptedTrack)),
      } as unknown as MediaDevices,
      onInterrupted: interrupted,
    });

    interruptedTrack.dispatchEvent(new Event('ended'));
    await interruptedSession.interrupted;
    expect(interrupted).toHaveBeenCalledOnce();

    const stopped = vi.fn();
    const stoppedTrack = new FakeTrack();
    const stoppedSession = await acquireRearCamera({
      mediaDevices: {
        getSupportedConstraints: () => ({}),
        getUserMedia: vi.fn().mockResolvedValue(fakeStream(stoppedTrack)),
      } as unknown as MediaDevices,
      onInterrupted: stopped,
    });
    stoppedSession.stop();
    expect(stopped).not.toHaveBeenCalled();
  });

  it('maps permission denial to an actionable error', async () => {
    const mediaDevices = {
      getSupportedConstraints: () => ({}),
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    } as unknown as MediaDevices;

    await expect(acquireRearCamera({ mediaDevices })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
