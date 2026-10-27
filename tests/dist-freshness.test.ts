import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const normalize = (text: string): string => text.replace(/\r\n/g, '\n');

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('dist bundle', () => {
  it('matches a fresh build of src/ (run `npm run build` and commit dist/ after changing src/)', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agent-sync-dist-'));
    const fresh = path.join(tempDir, 'agent-sync.mjs');

    await run(process.execPath, [path.join(root, 'scripts', 'build.mjs'), fresh], { cwd: root });

    const [expected, committed] = await Promise.all([
      readFile(fresh, 'utf8'),
      readFile(path.join(root, 'dist', 'agent-sync.mjs'), 'utf8'),
    ]);
    expect(normalize(committed)).toBe(normalize(expected));
  });
});
