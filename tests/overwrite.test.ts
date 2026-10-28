import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

describe('pull conflict handling', () => {
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

  it('never overwrites a file edited on both devices: it exits 5 and keeps it as it was', async () => {
    await publishNewVersionWhileBHasLocalEdit();

    const result = await sandbox.run('B', ['pull'], { confirm: true });

    expect(result.code).toBe(5);
    expect(result.questions).toEqual([]);
    expect(result.stderr).toContain('CLAUDE.md');
    expect(result.stderr).toContain('resolve');
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('B local edit\n');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
  });

  it('takes the repository version for conflicts with --yes and keeps a backup', async () => {
    await publishNewVersionWhileBHasLocalEdit();

    const result = await sandbox.run('B', ['pull', '--yes']);

    expect(result.code).toBe(0);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('shared v2\n');
    const [backup] = sandbox.backupsOf('B', 'CLAUDE.md');
    expect(fs.readFileSync(backup ?? '', 'utf8')).toBe('B local edit\n');
  });

  it('marks new files with +, updated ones with ~ and conflicts with ! in the list', async () => {
    await publishNewVersionWhileBHasLocalEdit();
    sandbox.write('A', 'agents/new.md', 'new agent\n');
    await sandbox.run('A', ['push']);

    const result = await sandbox.run('B', ['pull', '--dry-run']);

    expect(result.stdout).toContain('  + agents/new.md');
    expect(result.stdout).toContain('  ! CLAUDE.md');
  });

  it('applies repository-only changes without any question', async () => {
    sandbox.write('A', 'CLAUDE.md', 'shared v2\n');
    await sandbox.run('A', ['push']);

    const result = await sandbox.run('B', ['pull']);

    expect(result.code).toBe(0);
    expect(result.questions).toEqual([]);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('shared v2\n');
  });

  it('keeps local-only changes and reports them as waiting for push', async () => {
    sandbox.write('B', 'CLAUDE.md', 'B local edit\n');

    const result = await sandbox.run('B', ['pull']);

    expect(result.code).toBe(0);
    expect(result.output).toContain("waiting to be published (run 'push')");
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('B local edit\n');
  });

  it('treats files that only differ in line endings as identical', async () => {
    sandbox.write('B', 'CLAUDE.md', 'shared v1\r\n');

    const result = await sandbox.run('B', ['pull']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('Everything is up to date');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
  });

  it('reports status per side: to push, to pull and conflicts', async () => {
    await publishNewVersionWhileBHasLocalEdit();
    sandbox.write('A', 'agents/new.md', 'new agent\n');
    await sandbox.run('A', ['push']);
    sandbox.write('B', 'commands/mine.md', 'only here\n');

    const result = await sandbox.run('B', ['status']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('To push');
    expect(result.stdout).toContain('+ commands/mine.md');
    expect(result.stdout).toContain('To pull');
    expect(result.stdout).toContain('+ agents/new.md');
    expect(result.stdout).toContain('CONFLICT');
    expect(result.stdout).toContain('! CLAUDE.md');
    expect(result.stdout).toContain("run 'resolve'");
  });

  it('status never writes anything', async () => {
    await publishNewVersionWhileBHasLocalEdit();
    const before = fs.readdirSync(sandbox.dataHome('B')).sort();

    await sandbox.run('B', ['status']);

    expect(fs.readdirSync(sandbox.dataHome('B')).sort()).toEqual(before);
  });
});
