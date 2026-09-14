import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { PrivateRecordingStorage } from './storage';

function createStorage(
  indexedDB: IDBFactory,
  now: () => number,
  maxItems = 2,
  ownerId = 'server-user-test',
  databaseName = `recordings-${crypto.randomUUID()}`,
) {
  return new PrivateRecordingStorage({
    ownerId,
    databaseName,
    indexedDB,
    now,
    retention: {
      maxAgeMs: 1_000,
      maxBytes: 100,
      maxItems,
      maxRecordingBytes: 100,
    },
  });
}

describe('PrivateRecordingStorage', () => {
  it('stores blobs and local metadata without localStorage', async () => {
    const storage = createStorage(new IDBFactory(), () => 100);
    const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const blob = new NodeBlob(['private video'], {
      type: 'video/webm',
    }) as unknown as Blob;

    const { metadata } = await storage.save({
      id: 'one',
      name: 'Local trip',
      blob,
      durationMs: 1_234,
    });
    const loaded = await storage.load(metadata.id);

    expect(loaded).toMatchObject({
      id: 'one',
      name: 'Local trip',
      durationMs: 1_234,
      mimeType: 'video/webm',
    });
    expect(loaded?.blob.size).toBe(blob.size);
    expect(
      await (loaded?.blob as unknown as NodeBlob | undefined)?.text(),
    ).toBe('private video');
    expect(localStorageWrite).not.toHaveBeenCalled();
    storage.close();
  });

  it('removes oldest recordings when retention is exceeded', async () => {
    let now = 100;
    const storage = createStorage(new IDBFactory(), () => now);
    await storage.save({
      id: 'oldest',
      blob: new Blob(['one'], { type: 'video/mp4' }),
      durationMs: 1,
    });
    now = 200;
    await storage.save({
      id: 'middle',
      blob: new Blob(['two'], { type: 'video/mp4' }),
      durationMs: 1,
    });
    now = 300;
    const result = await storage.save({
      id: 'newest',
      blob: new Blob(['three'], { type: 'video/mp4' }),
      durationMs: 1,
    });

    expect(result.removedIds).toEqual(['oldest']);
    expect((await storage.list()).map(({ id }) => id)).toEqual([
      'newest',
      'middle',
    ]);
    expect(await storage.load('oldest')).toBeUndefined();
    storage.close();
  });

  it('removes expired recordings and deletes blob plus metadata', async () => {
    let now = 100;
    const storage = createStorage(new IDBFactory(), () => now, 5);
    await storage.save({
      id: 'expired',
      blob: new Blob(['old'], { type: 'video/mp4' }),
      durationMs: 1,
    });
    now = 2_000;

    expect(await storage.cleanup()).toEqual(['expired']);
    expect(await storage.load('expired')).toBeUndefined();
    storage.close();
  });

  it('isolates clips across same-browser account changes', async () => {
    const indexedDB = new IDBFactory();
    const databaseName = `account-isolation-${crypto.randomUUID()}`;
    const accountA = createStorage(
      indexedDB,
      () => 100,
      5,
      'stable-server-user-a',
      databaseName,
    );
    await accountA.save({
      id: 'account-a-clip',
      blob: new Blob(['account a'], { type: 'video/mp4' }),
      durationMs: 1,
    });
    accountA.dispose();

    const accountB = createStorage(
      indexedDB,
      () => 200,
      5,
      'stable-server-user-b',
      databaseName,
    );
    expect(await accountB.list()).toEqual([]);
    await accountB.save({
      id: 'account-b-clip',
      blob: new Blob(['account b'], { type: 'video/mp4' }),
      durationMs: 1,
    });
    expect((await accountB.list()).map(({ id }) => id)).toEqual([
      'account-b-clip',
    ]);
    accountB.dispose();

    const signedBackInAccountA = createStorage(
      indexedDB,
      () => 300,
      5,
      'stable-server-user-a',
      databaseName,
    );
    expect((await signedBackInAccountA.list()).map(({ id }) => id)).toEqual([
      'account-a-clip',
    ]);
    signedBackInAccountA.dispose();
  });
});
