import { describe, expect, it, vi } from 'vitest';
import { createReplayInput } from './replay';

describe('createReplayInput', () => {
  it('accepts local videos and revokes their object URL exactly once', () => {
    const revokeObjectURL = vi.fn();
    const replay = createReplayInput(
      new File(['video'], 'road.webm', { type: 'video/webm' }),
      {
        urlApi: {
          createObjectURL: () => 'blob:local-video',
          revokeObjectURL,
        },
      },
    );

    expect(replay.url).toBe('blob:local-video');
    replay.revoke();
    replay.revoke();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('rejects non-video and oversized files', () => {
    expect(() =>
      createReplayInput(new File(['text'], 'notes.txt', { type: 'text/plain' })),
    ).toThrow(/local video/);

    expect(() =>
      createReplayInput(
        new File(['too large'], 'road.mp4', { type: 'video/mp4' }),
        { maxBytes: 2 },
      ),
    ).toThrow(/MB or smaller/);
  });
});
