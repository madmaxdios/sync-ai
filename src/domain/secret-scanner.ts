import type { ScanCategory } from './scan-category';
import { SCAN_RULES, type ScanOptions } from './scan-rules';

export type { ScanOptions } from './scan-rules';

/** A line carrying this marker is never reported (for example a documented example value). */
export const ALLOW_MARKER = 'sync-ai:allow';

export interface ScanFinding {
  readonly category: ScanCategory;
  readonly label: string;
  /** 1-based line numbers. */
  readonly lines: readonly number[];
}

/** Returns one finding per rule that matches, with the lines it matches. Contents are never returned. */
export function scanText(content: string, options: ScanOptions = {}): ScanFinding[] {
  const textLines = content.split('\n').map((line) => (line.includes(ALLOW_MARKER) ? undefined : line));
  const findings: ScanFinding[] = [];
  for (const { category, label, matches } of SCAN_RULES) {
    const lines: number[] = [];
    textLines.forEach((line, index) => {
      if (line !== undefined && matches(line, options)) lines.push(index + 1);
    });
    if (lines.length > 0) findings.push({ category, label, lines });
  }
  return findings;
}
