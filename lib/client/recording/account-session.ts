import {
  PrivateRecordingStorage,
  type RecordingStorageOptions,
} from './storage';
import { RecordingError } from './types';

type ObjectUrlApi = Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;

export interface RecordingAccountSessionOptions extends RecordingStorageOptions {
  objectUrlApi?: ObjectUrlApi;
  storage?: PrivateRecordingStorage;
}

/**
 * Stable browser-only resource boundary for one authenticated account.
 * Create one instance per stable server user ID and dispose it before signout.
 */
export class RecordingAccountSession {
  readonly ownerId: string;
  readonly storage: PrivateRecordingStorage;
  private readonly objectUrlApi: ObjectUrlApi;
  private readonly objectUrls = new Set<string>();
  private readonly cleanups = new Set<() => void>();
  private disposed = false;

  constructor(options: RecordingAccountSessionOptions) {
    this.ownerId = options.ownerId;
    this.storage =
      options.storage ?? new PrivateRecordingStorage(options);
    if (this.storage.ownerId !== this.ownerId) {
      throw new RecordingError(
        'invalid-owner',
        'Recording storage must belong to the active authenticated user.',
      );
    }
    this.objectUrlApi = options.objectUrlApi ?? URL;
  }

  createObjectUrl(blob: Blob): string {
    this.assertActive();
    const url = this.objectUrlApi.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  revokeObjectUrl(url: string): void {
    if (this.objectUrls.delete(url)) {
      this.objectUrlApi.revokeObjectURL(url);
    }
  }

  registerCleanup(cleanup: () => void): () => void {
    this.assertActive();
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.clear();
    for (const url of this.objectUrls) {
      this.objectUrlApi.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    this.storage.dispose();
  }

  reset(): void {
    this.dispose();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new RecordingError(
        'invalid-owner',
        'This recording account session has been disposed.',
      );
    }
  }
}
