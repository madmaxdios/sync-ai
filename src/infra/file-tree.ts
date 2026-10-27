import fs from 'node:fs/promises';
import { toNativePath } from './file-system';

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

async function walk(
  base: string,
  rel: string,
  isDenied: (rel: string) => boolean,
  found: string[],
): Promise<void> {
  if (isDenied(rel)) return;

  const absolute = toNativePath(base, rel);
  let stats;
  try {
    stats = await fs.lstat(absolute);
  } catch {
    return;
  }

  // Symbolic links are skipped on purpose, both as files and as directories.
  if (stats.isFile()) {
    found.push(rel);
    return;
  }
  if (!stats.isDirectory()) return;

  for (const name of await fs.readdir(absolute)) {
    await walk(base, `${rel}/${name}`, isDenied, found);
  }
}

/** Lists allowlisted, non-denied regular files under `base` (sorted relative paths). */
export async function listTree(
  base: string,
  allow: readonly string[],
  isDenied: (rel: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of allow) {
    await walk(base, entry, isDenied, found);
  }
  return found.sort(compareCodeUnits);
}
