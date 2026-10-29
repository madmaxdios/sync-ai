import fs from 'node:fs/promises';
import path from 'node:path';

const SCAN_WORDS_FILE = 'scan-words.txt';

/**
 * Extra personal words the scanner must never let through, one per line (blank lines and lines
 * starting with `#` are ignored). The file lives next to the device's state and is never synced.
 */
export async function loadScanWords(dataHome: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(dataHome, SCAN_WORDS_FILE), 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  } catch {
    return [];
  }
}
