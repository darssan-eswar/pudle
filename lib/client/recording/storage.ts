import {
  RecordingError,
  type RecordingMetadata,
  type StoredRecording,
} from './types';

const DATABASE_NAME_PREFIX = 'pudle-private-recordings';
const DATABASE_VERSION = 1;
const BLOBS_STORE = 'blobs';
const METADATA_STORE = 'metadata';

export interface RecordingRetentionPolicy {
  maxAgeMs: number;
  maxBytes: number;
  maxItems: number;
  maxRecordingBytes: number;
}

export const DEFAULT_RETENTION_POLICY: RecordingRetentionPolicy = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
  maxBytes: 1_000_000_000,
  maxItems: 25,
  maxRecordingBytes: 500_000_000,
};

export interface SaveRecordingInput {
  blob: Blob;
  durationMs: number;
  name?: string;
  createdAt?: number;
  id?: string;
}

export interface SaveRecordingResult {
  metadata: RecordingMetadata;
  removedIds: string[];
}

export interface RecordingStorageOptions {
  ownerId: string;
  databaseName?: string;
  indexedDB?: IDBFactory;
  now?: () => number;
  retention?: Partial<RecordingRetentionPolicy>;
}

interface BlobRecord {
  id: string;
  blob?: Blob;
  bytes?: ArrayBuffer;
  mimeType?: string;
}

function isBlob(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function'
  );
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
    );
    transaction.addEventListener('error', () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
    );
  });
}

function storageError(error: unknown): RecordingError {
  if (error instanceof RecordingError) {
    return error;
  }
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') {
    return new RecordingError(
      'storage-quota',
      'This device does not have enough private storage for the recording.',
      { cause: error },
    );
  }
  return new RecordingError(
    'storage-failed',
    'The recording could not be stored on this device.',
    { cause: error },
  );
}

function recordingName(createdAt: number): string {
  return `Pudle recording ${new Date(createdAt).toLocaleString()}`;
}

export function recordingDatabaseName(
  ownerId: string,
  prefix = DATABASE_NAME_PREFIX,
): string {
  const normalizedOwnerId = ownerId.trim();
  if (
    normalizedOwnerId.length === 0 ||
    normalizedOwnerId.length > 200 ||
    normalizedOwnerId !== ownerId
  ) {
    throw new RecordingError(
      'invalid-owner',
      'A stable authenticated user ID is required for private recordings.',
    );
  }
  return `${prefix}::${encodeURIComponent(normalizedOwnerId)}`;
}

export class PrivateRecordingStorage {
  readonly ownerId: string;
  private readonly indexedDB: IDBFactory;
  private readonly databaseName: string;
  private readonly now: () => number;
  private readonly retention: RecordingRetentionPolicy;
  private databasePromise?: Promise<IDBDatabase>;
  private disposed = false;

  constructor(options: RecordingStorageOptions) {
    const indexedDB =
      options.indexedDB ??
      (typeof window === 'undefined' ? undefined : window.indexedDB);
    if (!indexedDB) {
      throw new RecordingError(
        'unsupported',
        'Private recording storage is not supported in this browser.',
      );
    }
    this.ownerId = options.ownerId;
    this.indexedDB = indexedDB;
    this.databaseName = recordingDatabaseName(
      options.ownerId,
      options.databaseName,
    );
    this.now = options.now ?? Date.now;
    this.retention = { ...DEFAULT_RETENTION_POLICY, ...options.retention };
  }

  async save(input: SaveRecordingInput): Promise<SaveRecordingResult> {
    const maximumSize = Math.min(
      this.retention.maxRecordingBytes,
      this.retention.maxBytes,
    );
    if (input.blob.size === 0) {
      throw new RecordingError(
        'storage-failed',
        'The browser produced an empty recording.',
      );
    }
    if (input.blob.size > maximumSize) {
      throw new RecordingError(
        'storage-quota',
        `Recordings must be ${Math.floor(maximumSize / 1_000_000)} MB or smaller.`,
      );
    }

    const createdAt = input.createdAt ?? this.now();
    const metadata: RecordingMetadata = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name?.trim() || recordingName(createdAt),
      createdAt,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      size: input.blob.size,
      mimeType: input.blob.type || 'application/octet-stream',
    };

    try {
      const bytes = await input.blob.arrayBuffer();
      const database = await this.open();
      const transaction = database.transaction(
        [BLOBS_STORE, METADATA_STORE],
        'readwrite',
      );
      transaction.objectStore(BLOBS_STORE).put({
        id: metadata.id,
        bytes,
        mimeType: metadata.mimeType,
      } satisfies BlobRecord);
      transaction.objectStore(METADATA_STORE).put(metadata);
      await transactionDone(transaction);
      const removedIds = await this.cleanup();
      return { metadata, removedIds };
    } catch (error) {
      if (error instanceof RecordingError) {
        throw error;
      }
      throw storageError(error);
    }
  }

  async list(): Promise<RecordingMetadata[]> {
    try {
      const database = await this.open();
      const transaction = database.transaction(METADATA_STORE, 'readonly');
      const metadata = await requestResult(
        transaction
          .objectStore(METADATA_STORE)
          .getAll() as IDBRequest<RecordingMetadata[]>,
      );
      await transactionDone(transaction);
      return metadata.sort((left, right) => right.createdAt - left.createdAt);
    } catch (error) {
      throw storageError(error);
    }
  }

  async load(id: string): Promise<StoredRecording | undefined> {
    try {
      const database = await this.open();
      const transaction = database.transaction(
        [BLOBS_STORE, METADATA_STORE],
        'readonly',
      );
      const blobRecord = await requestResult(
        transaction
          .objectStore(BLOBS_STORE)
          .get(id) as IDBRequest<BlobRecord | undefined>,
      );
      const metadata = await requestResult(
        transaction
          .objectStore(METADATA_STORE)
          .get(id) as IDBRequest<RecordingMetadata | undefined>,
      );
      await transactionDone(transaction);
      if (!blobRecord || !metadata) return undefined;
      if (isBlob(blobRecord.blob)) {
        return { ...metadata, blob: blobRecord.blob };
      }
      if (isArrayBuffer(blobRecord.bytes)) {
        return {
          ...metadata,
          blob: new Blob([blobRecord.bytes], {
            type: blobRecord.mimeType || metadata.mimeType,
          }),
        };
      }
      throw new RecordingError(
        'storage-failed',
        'The stored recording data is unreadable.',
      );
    } catch (error) {
      throw storageError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(
        [BLOBS_STORE, METADATA_STORE],
        'readwrite',
      );
      transaction.objectStore(BLOBS_STORE).delete(id);
      transaction.objectStore(METADATA_STORE).delete(id);
      await transactionDone(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async cleanup(): Promise<string[]> {
    const metadata = await this.list();
    const cutoff = this.now() - this.retention.maxAgeMs;
    let retainedBytes = 0;
    let retainedItems = 0;
    const removedIds: string[] = [];

    for (const item of metadata) {
      const withinLimits =
        item.createdAt >= cutoff &&
        retainedItems < this.retention.maxItems &&
        retainedBytes + item.size <= this.retention.maxBytes;
      if (withinLimits) {
        retainedItems += 1;
        retainedBytes += item.size;
      } else {
        removedIds.push(item.id);
      }
    }

    if (removedIds.length === 0) {
      return [];
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(
        [BLOBS_STORE, METADATA_STORE],
        'readwrite',
      );
      for (const id of removedIds) {
        transaction.objectStore(BLOBS_STORE).delete(id);
        transaction.objectStore(METADATA_STORE).delete(id);
      }
      await transactionDone(transaction);
      return removedIds;
    } catch (error) {
      throw storageError(error);
    }
  }

  close(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }

  private open(): Promise<IDBDatabase> {
    if (this.disposed) {
      return Promise.reject(
        new RecordingError(
          'invalid-owner',
          'This account recording storage has been disposed.',
        ),
      );
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(
          this.databaseName,
          DATABASE_VERSION,
        );
        request.addEventListener('upgradeneeded', () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(BLOBS_STORE)) {
            database.createObjectStore(BLOBS_STORE, { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains(METADATA_STORE)) {
            database.createObjectStore(METADATA_STORE, { keyPath: 'id' });
          }
        });
        request.addEventListener('success', () => {
          request.result.addEventListener('versionchange', () => {
            request.result.close();
            this.databasePromise = undefined;
          });
          resolve(request.result);
        });
        request.addEventListener('error', () =>
          {
            this.databasePromise = undefined;
            reject(
              request.error ?? new Error('IndexedDB could not be opened.'),
            );
          },
        );
        request.addEventListener('blocked', () => {
          this.databasePromise = undefined;
          reject(new Error('IndexedDB upgrade was blocked.'));
        });
      });
    }
    return this.databasePromise;
  }
}
