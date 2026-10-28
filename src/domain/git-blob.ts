import { createHash } from 'node:crypto';

/** Git object id of a blob (SHA-1 repositories), computed without spawning git. */
export function gitBlobId(content: Buffer): string {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}
