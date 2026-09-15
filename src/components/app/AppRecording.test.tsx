import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingAccountSession } from '@/lib/client/recording';
import { AppRecording, type AppRecordingHandle } from './AppRecording';

describe('AppRecording object URL lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('keeps playback and replay selections across renders and revokes both on signout disposal', async () => {
    const createdUrls = ['blob:recording', 'blob:replay'];
    const revokeObjectURL = vi.fn();
    const account = new RecordingAccountSession({
      ownerId: 'stable-server-user',
      databaseName: `app-recording-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
      objectUrlApi: {
        createObjectURL: () => createdUrls.shift() ?? 'blob:unexpected',
        revokeObjectURL,
      },
    });
    await account.storage.save({
      id: 'saved-recording',
      blob: new Blob(['saved'], { type: 'video/webm' }),
      durationMs: 1_000,
    });
    const recordingRef = createRef<AppRecordingHandle>();
    const onSceneChange = vi.fn();
    const onRecordingStateChange = vi.fn();

    const render = (activeSection: 'drive' | 'recordings' | 'ride') =>
      root.render(
        <AppRecording
          ref={recordingRef}
          account={account}
          activeSection={activeSection}
          online
          onSceneChange={onSceneChange}
          onCloudAnalysisChange={vi.fn()}
          onRecordingStateChange={onRecordingStateChange}
        />,
      );

    await act(async () => {
      render('recordings');
    });

    let playButton: HTMLButtonElement | undefined;
    for (let attempt = 0; attempt < 20 && !playButton; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      playButton = [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Play');
    }
    expect(playButton).toBeDefined();
    await act(async () => {
      playButton?.click();
    });
    let playbackVideo: HTMLVideoElement | null = null;
    for (let attempt = 0; attempt < 20 && !playbackVideo; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      playbackVideo = container.querySelector('video[aria-label^="Playback"]');
    }
    expect(playbackVideo?.getAttribute('src')).toBe('blob:recording');

    const replayInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const replayFile = new File(['replay'], 'replay.webm', { type: 'video/webm' });
    Object.defineProperty(replayInput, 'files', {
      configurable: true,
      value: [replayFile],
    });
    await act(async () => {
      replayInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('video[aria-label="Replay replay.webm"]')?.getAttribute('src'))
      .toBe('blob:replay');

    await act(async () => {
      render('ride');
      render('recordings');
    });
    expect(container.querySelector('video[aria-label^="Playback"]')?.getAttribute('src'))
      .toBe('blob:recording');
    expect(container.querySelector('video[aria-label="Replay replay.webm"]')?.getAttribute('src'))
      .toBe('blob:replay');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      recordingRef.current?.stopMedia();
      recordingRef.current?.revokeUrls();
      recordingRef.current?.dispose();
    });
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual([
      'blob:recording',
      'blob:replay',
    ]);
    expect(container.querySelector('video[aria-label="Replay replay.webm"]')).toBeNull();
  });
});
