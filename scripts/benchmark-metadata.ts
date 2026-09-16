import { readFile, stat } from 'node:fs/promises';
import { scoreMetadataBenchmark } from '../src/lib/client/inference/metadata-benchmark';
const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error('Usage: npm run benchmark:metadata -- <predictions.json>');
if ((await stat(file)).size > 2_000_000) throw new Error('Prediction file must be smaller than 2 MB.');
const data: unknown = JSON.parse(await readFile(file, 'utf8'));
console.log(JSON.stringify(scoreMetadataBenchmark(data), null, 2));
