import { describe, expect, it, vi } from 'vitest';
import type { LocalModelAdapter } from './contracts';
import {
  evaluateLocalModel,
  validateEvaluationFixtures,
} from './evaluation';

const isNumber = (input: unknown): input is number =>
  typeof input === 'number' && Number.isInteger(input) && input >= 0;

function syntheticAdapter(): LocalModelAdapter<number> {
  return {
    source: 'local-model',
    model: 'synthetic-contract-fixture',
    capability: () => ({ supported: true }),
    load: vi.fn(async () => undefined),
    infer: vi.fn(async (input) =>
      input % 2 === 0 ? [{ label: 'synthetic-even', confidence: 1 }] : [],
    ),
    dispose: vi.fn(),
  };
}

describe('local model evaluation harness', () => {
  it('rejects malformed, duplicate, and unbounded fixtures', () => {
    expect(() => validateEvaluationFixtures([], isNumber)).toThrow(/1–50/);
    expect(() =>
      validateEvaluationFixtures([{ id: 'Bad ID', input: 1 }], isNumber),
    ).toThrow(/lowercase URL-safe/);
    expect(() =>
      validateEvaluationFixtures([
        { id: 'same', input: 1 },
        { id: 'same', input: 2 },
      ], isNumber),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateEvaluationFixtures([
        { id: 'extra', input: 1, claimedAccuracy: 1 },
      ], isNumber),
    ).toThrow(/only id and input/);
  });

  it('runs sequentially and records latency without retaining fixture inputs', async () => {
    const times = [10, 17, 20, 29];
    const model = syntheticAdapter();
    const measurements = await evaluateLocalModel({
      adapter: model,
      fixtures: [
        { id: 'synthetic-even', input: 2 },
        { id: 'synthetic-odd', input: 3 },
      ],
      isInput: isNumber,
      now: () => times.shift() ?? 29,
    });

    expect(measurements).toEqual([
      {
        fixtureId: 'synthetic-even',
        source: 'local-model',
        model: 'synthetic-contract-fixture',
        startedAt: 10,
        completedAt: 17,
        latencyMs: 7,
        observationCount: 1,
      },
      {
        fixtureId: 'synthetic-odd',
        source: 'local-model',
        model: 'synthetic-contract-fixture',
        startedAt: 20,
        completedAt: 29,
        latencyMs: 9,
        observationCount: 0,
      },
    ]);
    expect(model.infer).toHaveBeenNthCalledWith(
      1,
      2,
      expect.any(AbortSignal),
    );
    expect(model.infer).toHaveBeenNthCalledWith(
      2,
      3,
      expect.any(AbortSignal),
    );
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(measurements[0]).not.toHaveProperty('input');
    expect(measurements[0]).not.toHaveProperty('observations');
  });

  it('disposes adapter resources when evaluation loading fails', async () => {
    const model = syntheticAdapter();
    model.load = vi.fn(async () => {
      throw new Error('load failed');
    });

    await expect(evaluateLocalModel({
      adapter: model,
      fixtures: [{ id: 'synthetic', input: 1 }],
      isInput: isNumber,
    })).rejects.toThrow('load failed');
    expect(model.dispose).toHaveBeenCalledOnce();
  });
});
