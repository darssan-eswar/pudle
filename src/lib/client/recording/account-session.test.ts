import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { RecordingAccountSession } from './account-session';
import { PrivateRecordingStorage } from './storage';

describe('RecordingAccountSession', () => {
  it('disposes capture, object URLs, and the account storage handle once', async () => {
    const storage = new PrivateRecordingStorage({
      ownerId: 'stable-server-user',
      databaseName: `account-session-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
    });
    const disposeStorage = vi.spyOn(storage, 'dispose');
    const captureCleanup = vi.fn();
    const revokeObjectURL = vi.fn();
    const account = new RecordingAccountSession({
      ownerId: 'stable-server-user',
      storage,
      objectUrlApi: {
        createObjectURL: () => 'blob:private-recording',
        revokeObjectURL,
      },
    });
    account.registerCleanup(captureCleanup);
    account.createObjectUrl(new Blob(['private']));

    account.reset();
    account.dispose();

    expect(captureCleanup).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      'blob:private-recording',
    );
    expect(disposeStorage).toHaveBeenCalledOnce();
    await expect(storage.list()).rejects.toMatchObject({
      code: 'invalid-owner',
    });
  });

  it('rejects storage belonging to another account', () => {
    const storage = new PrivateRecordingStorage({
      ownerId: 'server-user-a',
      databaseName: `mismatch-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
    });

    expect(
      () =>
        new RecordingAccountSession({
          ownerId: 'server-user-b',
          storage,
        }),
    ).toThrow(/active authenticated user/);
    storage.dispose();
  });
});
