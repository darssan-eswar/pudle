import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const limit = 25 * 1024 * 1024;
async function check(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await check(path);
    else if (entry.isFile()) {
      const { size } = await stat(path);
      if (size > limit) throw new Error(`Static asset exceeds the 25 MiB hosting limit: ${path} (${size} bytes)`);
      count += 1;
    }
  }
  return count;
}
console.log(`Checked ${await check('dist/client')} static assets against the 25 MiB hosting limit.`);
