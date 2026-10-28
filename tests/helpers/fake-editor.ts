import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CODE_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.0.0 (fake)');
  process.exit(0);
}
fs.appendFileSync(path.join(process.env.FAKE_EDITOR_DIR, 'calls.log'), JSON.stringify(args) + '\\n');
const result = args[args.length - 1];
const merged = process.env.FAKE_EDITOR_RESULT;
if (merged !== undefined) fs.writeFileSync(result, merged);
process.exit(Number(process.env.FAKE_EDITOR_EXIT || 0));
`;

/** A fake VS Code `code` executable that records how it was called (POSIX only). */
export class FakeEditor {
  private readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-editor-'));
  private readonly binDir = path.join(this.root, 'bin');

  constructor() {
    fs.mkdirSync(this.binDir, { recursive: true });
    fs.writeFileSync(path.join(this.binDir, 'code'), FAKE_CODE_SCRIPT, { mode: 0o755 });
  }

  /** Environment overrides that put the fake on PATH; `result` is what it writes as merge result. */
  env(options: { result?: string; exitCode?: number } = {}): Record<string, string | undefined> {
    return {
      PATH: `${this.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_EDITOR_DIR: this.root,
      FAKE_EDITOR_RESULT: options.result,
      FAKE_EDITOR_EXIT: String(options.exitCode ?? 0),
    };
  }

  /** Argument lists of every real invocation (the `--version` probe is not recorded). */
  calls(): string[][] {
    const log = path.join(this.root, 'calls.log');
    if (!fs.existsSync(log)) return [];
    return fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
