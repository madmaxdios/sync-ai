import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

/** A fake `claude` that logs its arguments and succeeds (POSIX only, like the fake gh). */
const FAKE_CLAUDE = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_CLAUDE_LOG, process.argv.slice(2).join(' ') + '\\n');
`;

const MANIFEST = JSON.stringify({
  version: 1,
  plugins: [
    { id: 'frontend-design@claude-plugins-official', source: 'anthropics/claude-plugins-official' },
    { id: 'madmax@madmax', source: 'madmaxdios/madmax-config' },
  ],
}, null, 2) + '\n';

describe.skipIf(process.platform === 'win32')('plugins listed by the repository', () => {
  let sandbox: Sandbox;
  let bin: string;
  let log: string;

  beforeEach(async () => {
    bin = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-claude-'));
    log = path.join(bin, 'calls.log');
    fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
    sandbox = new Sandbox({ autoList: true });
    sandbox.write('A', 'CLAUDE.md', 'instructions\n');
    sandbox.write('A', '.sync-ai-plugins.json', MANIFEST);
    await sandbox.connect('A');
    await sandbox.run('A', ['push']);
    await sandbox.connect('B');
  });
  afterEach(() => {
    sandbox.cleanup();
    fs.rmSync(bin, { recursive: true, force: true });
  });

  const env = () => ({ PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_CLAUDE_LOG: log });
  const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);

  it('adds only the marketplaces that are missing, even when a known one was added from another source', async () => {
    sandbox.write('B', 'plugins/known_marketplaces.json', JSON.stringify({
      'claude-plugins-official': { source: { source: 'git', url: 'https://github.com/anthropics/claude-plugins-official.git' } },
    }));

    await sandbox.run('B', ['pull'], { env: env() });

    expect(calls()).toEqual([
      'plugin install frontend-design@claude-plugins-official --yes',
      'plugin marketplace add madmaxdios/madmax-config',
      'plugin install madmax@madmax --yes',
    ]);
  });

  it('installs a missing plugin even when every file already matches', async () => {
    // The fake records nothing in installed_plugins.json, so the plugins stay missing.
    await sandbox.run('B', ['pull'], { env: env() });
    fs.rmSync(log, { force: true });

    await sandbox.run('B', ['pull'], { env: env() });

    expect(calls()).toContain('plugin install madmax@madmax --yes');
  });
});
