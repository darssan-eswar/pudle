import { IDBFactory } from 'fake-indexeddb';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingAccountSession } from './account-session';
import { RecordingError } from './types';
import {
  useRecordingController,
  type RecordingControllerApi,
} from './use-recording-controller';

class FakeTrack extends EventTarget {
  stop = vi.fn();
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true;
  readonly mimeType = 'video/mp4';
  state: RecordingState = 'inactive';

  constructor(stream: MediaStream) {
    super();
    void stream;
  }

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    const dataEvent = new Event('dataavailable') as BlobEvent;
    Object.defineProperty(dataEvent, 'data', {
      value: new Blob(['synthetic recording'], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function mediaStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function account(ownerId = crypto.randomUUID()): RecordingAccountSession {
  return new RecordingAccountSession({
    ownerId,
    databaseName: `controller-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory(),
    objectUrlApi: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: vi.fn(),
    },
  });
}

interface MountedController {
  account: RecordingAccountSession;
  controller(): RecordingControllerApi;
  root: Root;
}

function mountController(
  onEvent = vi.fn(),
  recordingAccount = account(),
): MountedController {
  let current: RecordingControllerApi | undefined;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function Harness(): ReactNode {
    current = useRecordingController({
      account: recordingAccount,
      onEvent,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    account: recordingAccount,
    controller: () => {
      if (!current) {
        throw new Error('Controller was not mounted.');
      }
      return current;
    },
    root,
  };
}

function installPendingCamera() {
  const request = deferred<MediaStream>();
  const getUserMedia = vi.fn(() => request.promise);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getSupportedConstraints: () => ({ facingMode: true }),
      getUserMedia,
    },
  });
  return { getUserMedia, request };
}

async function resolveAfterCancellation(
  cancel: (mounted: MountedController) => void,
) {
  const { request } = installPendingCamera();
  const onEvent = vi.fn();
  const mounted = mountController(onEvent);
  let acquisition!: Promise<void>;
  act(() => {
    acquisition = mounted.controller().acquireCamera();
  });
  act(() => cancel(mounted));
  const track = new FakeTrack();
  await act(async () => {
    request.resolve(mediaStream(track));
    await acquisition;
  });

  expect(track.stop).toHaveBeenCalledOnce();
  expect(onEvent).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'stream-ready' }),
  );
  return mounted;
}

describe('useRecordingController acquisition lifecycle', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'MediaRecorder',
      FakeMediaRecorder as unknown as typeof MediaRecorder,
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('stops a stream that resolves after camera release', async () => {
    const mounted = await resolveAfterCancellation(({ controller }) =>
      controller().releaseCamera(),
    );
    expect(mounted.controller().state).toBe('idle');
    act(() => mounted.root.unmount());
    mounted.account.dispose();
  });

  it('stops a stream that resolves after controller reset', async () => {
    const mounted = await resolveAfterCancellation(({ controller }) =>
      controller().reset(),
    );
    expect(mounted.controller().state).toBe('idle');
    act(() => mounted.root.unmount());
  });

  it('stops a stream that resolves after account signout disposal', async () => {
    const mounted = await resolveAfterCancellation(({ account: session }) =>
      session.dispose(),
    );
    act(() => mounted.root.unmount());
  });

  it('uses one getUserMedia request for overlapping acquire calls', async () => {
    const { getUserMedia, request } = installPendingCamera();
    const onEvent = vi.fn();
    const mounted = mountController(onEvent);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = mounted.controller().acquireCamera();
      second = mounted.controller().acquireCamera();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    const track = new FakeTrack();
    await act(async () => {
      request.resolve(mediaStream(track));
      await Promise.all([first, second]);
    });

    expect(mounted.controller().state).toBe('ready');
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stream-ready' }),
    );
    mounted.account.dispose();
    expect(track.stop).toHaveBeenCalledOnce();
    act(() => mounted.root.unmount());
  });

  it('stops a stream that resolves after unmount without publishing it', async () => {
    const { request } = installPendingCamera();
    const onEvent = vi.fn();
    const mounted = mountController(onEvent);
    let acquisition!: Promise<void>;
    act(() => {
      acquisition = mounted.controller().acquireCamera();
    });
    act(() => mounted.root.unmount());
    const track = new FakeTrack();

    await act(async () => {
      request.resolve(mediaStream(track));
      await acquisition;
    });

    expect(track.stop).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stream-ready' }),
    );
    mounted.account.dispose();
  });

  it('returns an explicit failure when the completed recording cannot be stored', async () => {
    const track = new FakeTrack();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getSupportedConstraints: () => ({ facingMode: true }),
        getUserMedia: vi.fn().mockResolvedValue(mediaStream(track)),
      },
    });
    const recordingAccount = account();
    vi.spyOn(recordingAccount.storage, 'save').mockRejectedValue(
      new RecordingError(
        'storage-quota',
        'This device does not have enough private storage for the recording.',
      ),
    );
    const mounted = mountController(vi.fn(), recordingAccount);

    await act(async () => {
      await mounted.controller().acquireCamera();
    });
    act(() => mounted.controller().start());
    let result!: Awaited<ReturnType<RecordingControllerApi['stop']>>;
    await act(async () => {
      result = await mounted.controller().stop();
    });

    expect(result).toMatchObject({
      saved: false,
      error: {
        code: 'storage-quota',
        message: 'This device does not have enough private storage for the recording.',
      },
    });
    expect(mounted.controller().state).toBe('error');
    act(() => mounted.root.unmount());
    recordingAccount.dispose();
  });
});
