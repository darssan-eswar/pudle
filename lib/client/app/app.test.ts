import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { RecordingAccountSession } from '../recording';
import {
  authApi,
  authReducer,
  cloudAnalysisClient,
  cloudAnalysisReducer,
  CloudFrameController,
  disposeLocalSession,
  groundPudyAnswer,
  initialAuthState,
  parseCloudAnalysisAvailability,
  parseCloudAnalysisStatus,
  parsePudyRequest,
  recordingsApi,
} from './index';

const userA = { id: 'server-user-a', email: 'a@example.com', displayName: 'A' };
const userB = { id: 'server-user-b', email: 'b@example.com', displayName: 'B' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth client state', () => {
  it('restores a stable server identity and never adds a client user id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: userA })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: userA })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authApi.session()).resolves.toEqual({ user: userA });
    await authApi.signIn({ email: userA.email, password: 'password-long-enough' });

    const mutation = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mutation[0]).toBe('/api/auth/signin');
    expect(mutation[1].headers).toMatchObject({ 'X-Pudle-CSRF': '1' });
    expect(JSON.parse(String(mutation[1].body))).toEqual({
      email: userA.email,
      password: 'password-long-enough',
    });
  });

  it('moves through session, mutation, and signout states', () => {
    const authenticated = authReducer(initialAuthState, {
      type: 'session-resolved',
      user: userA,
    });
    expect(authenticated.status).toBe('authenticated');
    const signingOut = authReducer(authenticated, { type: 'sign-out' });
    expect(signingOut).toMatchObject({ status: 'signing-out', user: userA });
    expect(authReducer(signingOut, { type: 'signed-out' })).toEqual({
      status: 'anonymous',
      user: null,
      error: null,
    });
  });
});

describe('account-isolated recording lifecycle', () => {
  it('creates stable, distinct IndexedDB namespaces for A -> signout -> B', async () => {
    const accountA = new RecordingAccountSession({ ownerId: userA.id, indexedDB });
    const secondAccountA = new RecordingAccountSession({ ownerId: userA.id, indexedDB });
    const accountB = new RecordingAccountSession({ ownerId: userB.id, indexedDB });
    await accountA.storage.save({
      id: 'account-a-clip',
      blob: new Blob(['private-a'], { type: 'video/webm' }),
      durationMs: 1000,
    });
    expect((await secondAccountA.storage.list()).map((item) => item.id)).toContain('account-a-clip');
    expect(await accountB.storage.list()).toEqual([]);
    accountA.dispose();
    secondAccountA.dispose();
    accountB.dispose();
  });

  it('stops media before revoking URLs, closing storage, and clearing UI', async () => {
    const order: string[] = [];
    await disposeLocalSession({
      stopMedia: async () => {
        order.push('stop');
      },
      revokeUrls: () => order.push('revoke'),
      closeStorage: () => order.push('close'),
      clearUi: () => order.push('clear'),
    });
    expect(order).toEqual(['stop', 'revoke', 'close', 'clear']);
  });
});

describe('Pudy command boundary', () => {
  it('requires the wake phrase for recognized speech', () => {
    expect(parsePudyRequest('stop recording', true)).toEqual({
      kind: 'missing-wake-phrase',
    });
    expect(parsePudyRequest('Hey Pudy, stop recording', true)).toEqual({
      kind: 'action',
      action: 'stop-recording',
    });
  });
});

describe('cloud analysis status contract', () => {
    const context = {
      currentAnalysisId: 'current',
      currentCaptureStartedAt: 10_000,
      now: 20_000,
      maxResultAgeMs: 15_000,
    };

    it.each([
      [{ status: 'unconfigured' }, 'unconfigured'],
      [{ status: 'processing', analysisId: 'current', startedAt: 11_000 }, 'processing'],
      [{ status: 'timeout' }, 'timeout'],
      [{ status: 'quota', retryable: true, retryAfterMs: 5_000 }, 'quota'],
      [{ status: 'failure', retryable: true }, 'failure'],
      [{ status: 'unexpected' }, 'malformed'],
      [null, 'malformed'],
    ])('normalizes %j as %s', (payload, expected) => {
      expect(parseCloudAnalysisStatus(payload, context).status).toBe(expected);
    });

    it('accepts only a current result for the active analysis', () => {
      expect(parseCloudAnalysisStatus({
        status: 'ready',
        analysisId: 'current',
        capturedAt: 15_000,
        summary: 'Standing water is visible.',
      }, context)).toMatchObject({
        status: 'ready',
        result: { summary: 'Standing water is visible.', capturedAt: 15_000 },
      });

      expect(parseCloudAnalysisStatus({
        status: 'ready',
        analysisId: 'older',
        capturedAt: 15_000,
        summary: 'Old observation',
      }, context)).toMatchObject({ status: 'stale', result: null });
    });

    it('clears a prior result when processing or a retryable failure begins', () => {
      const ready = parseCloudAnalysisStatus({
        status: 'ready',
        analysisId: 'current',
        capturedAt: 15_000,
        summary: 'Current observation',
      }, context);
      const processing = cloudAnalysisReducer(ready, {
        type: 'request',
        analysisId: 'next',
        startedAt: 21_000,
      });
      expect(processing).toMatchObject({ status: 'processing', result: null });

      const failed = cloudAnalysisReducer(processing, {
        type: 'status',
        state: parseCloudAnalysisStatus({
          status: 'failure',
          retryable: true,
          message: 'Try again.',
        }, context),
      });
      expect(failed).toMatchObject({
        status: 'failure',
        result: null,
        retryable: true,
      });
    });

    it('submits only the explicitly supplied compressed frame with required consent headers', async () => {
        const result = {
          jobId: 'job-1',
          result: {
            summary: 'Clear',
            observations: ['clear-road'],
            confidence: 0.9,
            uncertainty: 'Limited view',
            source: 'cloud-ai',
            model: 'model',
            capturedAt: 12_000,
            analyzedAt: 13_000,
          },
        };
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(result)),
        );
        vi.stubGlobal('fetch', fetchMock);
        const frame = new Blob(['jpeg'], { type: 'image/jpeg' });
        const controller = new AbortController();

        await expect(cloudAnalysisClient.submitFrame(frame, {
          capturedAt: 12_000,
          idempotencyKey: 'request-key',
          signal: controller.signal,
        })).resolves.toEqual(result);
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(request.body).toBe(frame);
        expect(request.headers).toMatchObject({
          'X-Pudle-CSRF': '1',
          'X-Pudle-Cloud-Analysis-Consent': 'true',
          'Idempotency-Key': 'request-key',
          'X-Pudle-Captured-At': '12000',
      });
    });

    it('preserves provider error codes and rejects invalid frame types before fetch', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          error: 'Quota unavailable.',
          code: 'provider_quota',
        }), { status: 503 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(cloudAnalysisClient.submitFrame(
        new Blob(['jpeg'], { type: 'image/jpeg' }),
        {
          capturedAt: 12_000,
          idempotencyKey: 'request-key',
          signal: new AbortController().signal,
        },
      )).rejects.toMatchObject({ code: 'provider_quota', status: 503 });
      await expect(cloudAnalysisClient.submitFrame(
        new Blob(['video'], { type: 'video/webm' }),
        {
          capturedAt: 12_000,
          idempotencyKey: 'request-key-2',
          signal: new AbortController().signal,
        },
      )).rejects.toThrow(/JPEG or WebP/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    describe('recording metadata adapter', () => {
      it('syncs recording metadata without including media blobs', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ recording: { id: 'server-id' } })),
        );
        vi.stubGlobal('fetch', fetchMock);
        await recordingsApi.create({
          clientRecordingId: 'local-id',
          durationMs: 1_000,
          mimeType: 'video/webm',
          byteLength: 42,
          capturedAt: 10_000,
        });
        const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(JSON.parse(String(request.body))).toEqual({
          clientRecordingId: 'local-id',
          durationMs: 1_000,
          mimeType: 'video/webm',
          byteLength: 42,
          capturedAt: 10_000,
        });
      });
    });

    describe('cloud frame cadence', () => {
      it('allows one in flight, enforces five seconds, and aborts on disable', async () => {
        let now = 0;
        let release: (() => void) | undefined;
        let observedSignal: AbortSignal | undefined;
        const task = vi.fn((signal: AbortSignal) => {
          observedSignal = signal;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        });
        const controller = new CloudFrameController(task, () => now);
        controller.enable();
        const first = controller.tick();
        await expect(controller.tick()).resolves.toBe(false);
        controller.disable();
        expect(observedSignal?.aborted).toBe(true);
        release?.();
        await expect(first).resolves.toBe(true);

        controller.enable();
        now = 4_999;
        await expect(controller.tick()).resolves.toBe(false);
        now = 5_000;
        const next = controller.tick();
        release?.();
        await expect(next).resolves.toBe(true);
        expect(task).toHaveBeenCalledTimes(2);
      });
    });

    it('accepts the final availability contract without enabling uploads', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          configured: true,
          provider: 'configured-provider',
          model: 'configured-model',
        })),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(cloudAnalysisClient.status()).resolves.toMatchObject({
        status: 'available',
        result: null,
        provider: 'configured-provider',
        model: 'configured-model',
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/analysis/status',
        { credentials: 'same-origin', cache: 'no-store' },
      );
      expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ method: 'POST' });
    });

    it('keeps uploads off when availability is missing or malformed', async () => {
      expect(parseCloudAnalysisAvailability({
        configured: true,
        provider: null,
        model: null,
      })).toMatchObject({ status: 'unconfigured', result: null });

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      await expect(cloudAnalysisClient.status()).resolves.toMatchObject({
        status: 'unconfigured',
        result: null,
      });
    });
  });

describe('Pudy grounding', () => {
  it('allows only explicit local actions and does not execute arbitrary text', () => {
    expect(parsePudyRequest('Hey Pudy delete every file', true)).toEqual({
      kind: 'unknown',
    });
    expect(parsePudyRequest('Hey Pudy prepare a hazard report', true)).toEqual({
      kind: 'action',
      action: 'prepare-hazard-report',
    });
  });

  it('grounds answers only in the displayed context', () => {
    expect(
      groundPudyAnswer(parsePudyRequest('what is ahead'), {
        sceneLabels: ['car'],
        nearbyLabels: [],
      }),
    ).toBe('No nearby road activity is currently displayed.');
    expect(
      groundPudyAnswer(parsePudyRequest('what is visible'), {
        sceneLabels: ['car', 'truck'],
        nearbyLabels: ['Flooding 0.4 mi'],
      }),
    ).toBe('Local scene: car, truck.');
  });
});
