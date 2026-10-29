import fs from 'node:fs/promises';
import type { ScanCategory } from '../domain/scan-category';
import { isBinary } from '../domain/line-endings';
import { scanText } from '../domain/secret-scanner';
import { loadScanWords } from '../infra/scan-words';
import { toNativePath } from '../infra/file-system';
import type { Io } from '../infra/io';
import type { CommandContext } from './context';

/** One thing the scanner refuses to publish. It never carries the matched text. */
export interface PathFinding {
  readonly rel: string;
  readonly line: number;
  readonly category: ScanCategory;
  readonly label: string;
}

/** Scans the files that are about to be published (relative to the agent's home). */
export async function scanFilesToPublish(
  context: CommandContext,
  files: readonly string[],
): Promise<PathFinding[]> {
  const options = { username: context.username, words: await loadScanWords(context.dataHome) };
  const found = new Map<string, PathFinding>();
  for (const rel of files) {
    const content = await fs.readFile(toNativePath(context.agent.home, rel));
    if (isBinary(content)) continue;
    for (const finding of scanText(content.toString('utf8'), options)) {
      for (const line of finding.lines) {
        const key = `${rel}\0${line}\0${finding.category}`;
        if (!found.has(key)) found.set(key, { rel, line, category: finding.category, label: finding.label });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
}

export function printFindings(io: Io, findings: readonly PathFinding[]): void {
  for (const { rel, line, category, label } of findings) io.warn(`  ${rel}:${line}  ${category} (${label})`);
}

export function filesWithFindings(findings: readonly PathFinding[]): number {
  return new Set(findings.map((finding) => finding.rel)).size;
}

/** The first few `path:line` places, for a one-line message. */
export function describeLocations(findings: readonly PathFinding[], limit = 3): string {
  const places = [...new Set(findings.map((finding) => `${finding.rel}:${finding.line}`))];
  const shown = places.slice(0, limit).join(', ');
  return places.length > limit ? `${shown}, ...` : shown;
}
