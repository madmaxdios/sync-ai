import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

describe('pull overwrite handling', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = new Sandbox();
    sandbox.write('A', 'CLAUDE.md', 'shared v1\n');
    await sandbox.run('A', ['init', sandbox.remote]);
    await sandbox.run('A', ['push']);
    await sandbox.run('B', ['init', sandbox.remote]);
    await sandbox.run('B', ['pull']);
  });

  afterEach(() => sandbox.cleanup());

  async function publishNewVersionWhileBHasLocalEdit(): Promise<void> {
    sandbox.write('B', 'CLAUDE.md', 'B local edit\n');
    sandbox.write('A', 'CLAUDE.md', 'shared v2\n');
    await sandbox.run('A', ['push']);
  }

  it('overwrites after an interactive confirmation and keeps a backup', async () => {
    await publishNewVersionWhileBHasLocalEdit();

    const result = await sandbox.run('B', ['pull'], { confirm: true });

    expect(result.code).toBe(0);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('shared v2\n');
    const [backup] = sandbox.backupsOf('B', 'CLAUDE.md');
    expect(fs.readFileSync(backup ?? '', 'utf8')).toBe('B local edit\n');
  });

  it('keeps local files when the interactive answer is no', async () => {
    await publishNewVersionWhileBHasLocalEdit();

    const result = await sandbox.run('B', ['pull'], { confirm: false });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('--yes');
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('B local edit\n');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
  });

  it('marks overwritten files with ~ and new files with + in the list', async () => {
    await publishNewVersionWhileBHasLocalEdit();
    sandbox.write('A', 'agents/new.md', 'new agent\n');
    await sandbox.run('A', ['push']);

    const result = await sandbox.run('B', ['pull', '--dry-run']);

    expect(result.stdout).toContain('  + agents/new.md');
    expect(result.stdout).toContain('  ~ CLAUDE.md');
  });

  it('treats files that only differ in line endings as identical', async () => {
    sandbox.write('B', 'CLAUDE.md', 'shared v1\r\n');

    const result = await sandbox.run('B', ['pull']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('Everything is up to date');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
  });

  it('reports status differences for modified, local-only and repo-only files', async () => {
    sandbox.write('B', 'CLAUDE.md', 'B local edit\n');
    sandbox.write('B', 'commands/mine.md', 'only here\n');

    const result = await sandbox.run('B', ['status']);

    expect(result.stdout).toContain('~ modified        CLAUDE.md');
    expect(result.stdout).toContain('+ local only      commands/mine.md');
  });
});
