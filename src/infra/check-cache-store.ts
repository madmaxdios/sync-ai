import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyCache, parseCache, serializeCache, type CheckCache } from '../domain/check-cache';

const CACHE_FILE = 'check-cache.json';

/** An unreadable or missing cache is just an empty one: it only throttles and deduplicates. */
export async function loadCheckCache(dataHome: string): Promise<CheckCache> {
  try {
    const content = await fs.readFile(path.join(dataHome, CACHE_FILE), 'utf8');
    return parseCache(content) ?? emptyCache();
  } catch {
    return emptyCache();
  }
}

/** Writes the cache through a temporary file so a crash never leaves it half written. */
export async function saveCheckCache(dataHome: string, cache: CheckCache): Promise<void> {
  await fs.mkdir(dataHome, { recursive: true });
  const target = path.join(dataHome, CACHE_FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, serializeCache(cache));
  await fs.rename(temporary, target);
}
