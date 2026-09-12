import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingAccountSession } from '@/lib/client/recording';
import { RecordingsLibrary } from './RecordingsLibrary';

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('RecordingsLibrary delete confirmation', () => {
  it('supports accessible cancel and confirm without a native browser dialog', async () => {
    const account = new RecordingAccountSession({
      ownerId: 'recording-dialog-user',
      databaseName: `recording-dialog-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
      objectUrlApi: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: vi.fn(),
      },
    });
    await account.storage.save({
      id: 'clip-one',
      name: 'Synthetic clip',
      blob: new Blob(['video'], { type: 'video/webm' }),
      durationMs: 1_000,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RecordingsLibrary account={account} />);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Synthetic clip'),
    );
    const deleteButton = [...container.querySelectorAll('button')]
      .find(({ textContent }) => textContent === 'Delete') as HTMLButtonElement;

    act(() => deleteButton.click());
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull(),
    );

    const keepButton = [...container.querySelectorAll('button')]
      .find(({ textContent }) => textContent === 'Keep recording') as HTMLButtonElement;
    act(() => keepButton.click());
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alertdialog"]')).toBeNull(),
    );
    expect(await account.storage.load('clip-one')).toBeDefined();

    act(() => deleteButton.click());
    const confirmButton = [...container.querySelectorAll('button')]
      .find(({ textContent }) => textContent === 'Delete permanently') as HTMLButtonElement;
    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    await vi.waitFor(async () =>
      expect(await account.storage.load('clip-one')).toBeUndefined(),
    );
    expect(container.textContent).toContain('No recordings are stored on this device.');
    act(() => root.unmount());
    account.dispose();
  });
});
