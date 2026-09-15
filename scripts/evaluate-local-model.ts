import type {
  LocalModelAdapter,
  LocalObservation,
} from '../src/lib/client/inference/contracts';
import { evaluateLocalModel } from '../src/lib/client/inference/evaluation';

interface SyntheticInput {
  workUnits: number;
}

function isSyntheticInput(input: unknown): input is SyntheticInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'workUnits') return false;
  const workUnits = (input as Record<string, unknown>).workUnits;
  return (
    typeof workUnits === 'number'
    && Number.isInteger(workUnits)
    && workUnits >= 1
    && workUnits <= 10_000
  );
}

const adapter: LocalModelAdapter<SyntheticInput> = {
  source: 'local-model',
  model: 'synthetic-contract-fixture',
  capability: () => ({ supported: true }),
  async load() {},
  async infer(input): Promise<LocalObservation[]> {
    let checksum = 0;
    for (let index = 0; index < input.workUnits; index += 1) {
      checksum = (checksum + index) % 97;
    }
    return checksum >= 0
      ? [{ label: 'synthetic-contract-check', confidence: 1 }]
      : [];
  },
  dispose() {},
};

const measurements = await evaluateLocalModel({
  adapter,
  fixtures: [
    { id: 'synthetic-small', input: { workUnits: 100 } },
    { id: 'synthetic-large', input: { workUnits: 10_000 } },
  ],
  isInput: isSyntheticInput,
});

console.log(JSON.stringify({
  disclaimer:
    'Synthetic fixtures validate scheduler and measurement software only; they do not measure road-scene accuracy.',
  measurements,
}, null, 2));
