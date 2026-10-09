// -----------------------------------------------------------------------------
// Small JSON files in /data, the only writable volume of the container.
//
// Written atomically (temporary file + rename): a container stopped in the
// middle of a write must never leave a truncated token behind, which would
// sign the user out.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_DIR = process.env.RING_DATA_DIR || '/data';

/** @returns {Promise<object|null>} the parsed file, null when absent or unreadable */
export async function readJson(dir, name) {
  try {
    return JSON.parse(await readFile(join(dir, name), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJson(dir, name, value) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const tmp = `${path}.tmp`;
  // 0600: the token file holds a credential.
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
