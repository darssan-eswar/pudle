import type { LocalModelAdapter } from './contracts';

const MAX_FIXTURES = 50;
const FIXTURE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface EvaluationFixture<Input> {
  id: string;
  input: Input;
}

export interface EvaluationMeasurement {
  fixtureId: string;
  source: 'local-model';
  model: string;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  observationCount: number;
}

export function validateEvaluationFixtures<Input>(
  value: unknown,
  isInput: (input: unknown) => input is Input,
): EvaluationFixture<Input>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FIXTURES) {
    throw new Error(`Evaluation fixtures must contain 1–${MAX_FIXTURES} items.`);
  }
  const identifiers = new Set<string>();
  return value.map((fixture) => {
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
      throw new Error('Each evaluation fixture must be an object.');
    }
    const keys = Object.keys(fixture).sort();
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'input') {
      throw new Error('Each evaluation fixture must contain only id and input.');
    }
    const { id, input } = fixture as Record<string, unknown>;
    if (typeof id !== 'string' || !FIXTURE_ID.test(id)) {
      throw new Error('Evaluation fixture IDs must be lowercase URL-safe labels.');
    }
    if (identifiers.has(id)) {
      throw new Error(`Duplicate evaluation fixture ID: ${id}.`);
    }
    if (!isInput(input)) {
      throw new Error(`Evaluation fixture ${id} has an invalid input.`);
    }
    identifiers.add(id);
    return { id, input };
  });
}

export async function evaluateLocalModel<Input>(options: {
  adapter: LocalModelAdapter<Input>;
  fixtures: unknown;
  isInput: (input: unknown) => input is Input;
  now?: () => number;
}): Promise<EvaluationMeasurement[]> {
  const fixtures = validateEvaluationFixtures(options.fixtures, options.isInput);
  const capability = options.adapter.capability();
  if (!capability.supported) {
    throw new Error(capability.reason ?? 'Local inference is unavailable.');
  }
  const now = options.now ?? (() => performance.now());
  const controller = new AbortController();
  try {
    await options.adapter.load(controller.signal);
    const measurements: EvaluationMeasurement[] = [];
    for (const fixture of fixtures) {
      const startedAt = now();
      const observations = await options.adapter.infer(
        fixture.input,
        controller.signal,
      );
      const completedAt = now();
      measurements.push({
        fixtureId: fixture.id,
        source: options.adapter.source,
        model: options.adapter.model,
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        observationCount: observations.length,
      });
    }
    return measurements;
  } finally {
    options.adapter.dispose();
  }
}
