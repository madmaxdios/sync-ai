import fs from 'node:fs/promises';
import { isBinary } from '../domain/line-endings';
import { scanText } from '../domain/secret-scanner';
import { toNativePath } from '../infra/file-system';
import type { CommandContext } from './context';

/** Scans the given files and reports findings; returns the number of findings. */
export async function scanFilesForSecrets(
  context: CommandContext,
  files: readonly string[],
): Promise<number> {
  let hits = 0;
  for (const rel of files) {
    const content = await fs.readFile(toNativePath(context.agent.home, rel));
    if (isBinary(content)) continue;
    for (const finding of scanText(content.toString('utf8'))) {
      context.io.warn(`  ${rel} (line ${finding.lines.join(',')}): ${finding.label}`);
      hits += 1;
    }
  }
  return hits;
}
