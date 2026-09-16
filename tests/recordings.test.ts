import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingStore, StoredRecording } from '../src/server/recordings/contracts';
import { createRecordingService } from '../src/server/recordings/service';
import { HttpError } from '../src/server/http';

const NOW = 1_800_000_000_000;

class MemoryRecordingStore implements RecordingStore {
  records = new Map<string, StoredRecording>();

  async cleanupExpired(now: number) {
    for (const [id, recording] of this.records) {
      if (recording.expiresAt <= now) this.records.delete(id);
    }
  }

  async list(userId: string, limit: number, now: number) {
    return [...this.records.values()]
      .filter((recording) => recording.userId === userId && recording.expiresAt > now)
      .slice(0, limit);
  }

  async find(userId: string, id: string, now: number) {
    const recording = this.records.get(id);
    return recording?.userId === userId && recording.expiresAt > now ? recording : null;
  }

  async create(recording: StoredRecording) {
    if ([...this.records.values()].some((item) => (
      item.userId === recording.userId && item.clientRecordingId === recording.clientRecordingId
    ))) {
      throw new Error('UNIQUE constraint');
    }
    this.records.set(recording.id, recording);
  }

  async update(
    userId: string,
    id: string,
    changes: Pick<StoredRecording, 'durationMs' | 'byteLength' | 'updatedAt'>,
    now: number,
  ) {
    const recording = await this.find(userId, id, now);
    if (!recording) return null;
    const updated = { ...recording, ...changes };
    this.records.set(id, updated);
    return updated;
  }

  async delete(userId: string, id: string) {
    const recording = this.records.get(id);
    if (!recording || recording.userId !== userId) return false;
    return this.records.delete(id);
  }
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    clientRecordingId: 'local-recording-1',
    durationMs: 12_000,
    mimeType: 'video/webm',
    byteLength: 456_000,
    capturedAt: NOW - 1_000,
    ...overrides,
  };
}

async function expectStatus(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, (error: unknown) => error instanceof HttpError && error.status === status);
}

test('recording metadata CRUD is owner-only and never accepts media content', async () => {
  const store = new MemoryRecordingStore();
  const service = createRecordingService({
    store,
    now: () => NOW,
    createId: () => 'recording-1',
  });
  const created = await service.create('owner', metadata());
  assert.equal(created.id, 'recording-1');
  assert.equal('userId' in created, false);
  assert.equal(JSON.stringify(created).includes('data:'), false);

  assert.deepEqual(await service.list('owner'), [created]);
  assert.deepEqual(await service.list('other'), []);
  await expectStatus(() => service.get('other', created.id), 404);
  await expectStatus(() => service.update('other', created.id, { durationMs: 1 }), 404);
  await expectStatus(() => service.delete('other', created.id), 404);

  const updated = await service.update('owner', created.id, { durationMs: 13_000 });
  assert.equal(updated.durationMs, 13_000);
  await service.delete('owner', created.id);
  await expectStatus(() => service.get('owner', created.id), 404);

  await expectStatus(
    () => service.create('owner', metadata({ media: 'data:video/webm;base64,AAAA' })),
    400,
  );
});

test('recording metadata is bounded, deduplicated, and removed by retention cleanup', async () => {
  let now = NOW;
  const store = new MemoryRecordingStore();
  let sequence = 0;
  const service = createRecordingService({
    store,
    now: () => now,
    createId: () => `recording-${++sequence}`,
  });
  await service.create('owner', metadata());
  await expectStatus(() => service.create('owner', metadata()), 409);
  await expectStatus(
    () => service.create('owner', metadata({ clientRecordingId: '../escape' })),
    400,
  );
  await expectStatus(
    () => service.create('owner', metadata({ byteLength: Number.MAX_SAFE_INTEGER })),
    400,
  );

  now += 24 * 60 * 60 * 1_000;
  assert.deepEqual(await service.list('owner'), []);
  assert.equal(store.records.size, 0);
});
