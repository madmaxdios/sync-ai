import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGh, pathWithoutGh } from './helpers/fake-gh';
import { Sandbox, type Device } from './helpers/sandbox';

describe.skipIf(process.platform === 'win32')('init without a URL (GitHub CLI)', () => {
  let sandbox: Sandbox;
  let gh: FakeGh;

  beforeEach(() => {
    sandbox = new Sandbox();
    gh = new FakeGh();
  });

  afterEach(() => {
    sandbox.cleanup();
    gh.cleanup();
  });

  const repoDir = (): string => path.join(sandbox.dataHome('A'), 'repo');
  const localHelpers = (): string[] =>
    execFileSync('git', ['-C', repoDir(), 'config', '--local', '--get-all', 'credential.helper'], {
      encoding: 'utf8',
    })
      .split('\n')
      .slice(0, -1);
  const created = (): string[] => gh.calls().filter((call) => call.startsWith('repo create'));

  it('exits 2 with an actionable message when gh is not installed', async () => {
    const result = await sandbox.run('A', ['init', '--yes'], { env: { PATH: pathWithoutGh() } });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('GitHub CLI (gh)');
    expect(result.stderr).toContain('pass the URL of a private repository');
    expect(fs.existsSync(repoDir())).toBe(false);
  });

  it('exits 2 and points to gh auth login when gh is not authenticated', async () => {
    const result = await sandbox.run('A', ['init', '--yes'], { env: gh.env({ authenticated: false }) });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('gh auth login');
    expect(created()).toEqual([]);
    expect(fs.existsSync(repoDir())).toBe(false);
  });

  it('creates a private repository, clones it and points to push', async () => {
    const result = await sandbox.run('A', ['init'], { confirm: true, env: gh.env({ protocol: 'ssh' }) });

    expect(result.code).toBe(0);
    expect(gh.repositories()).toEqual(['tester/sync-ai-data']);
    expect(created()).toHaveLength(1);
    expect(created()[0]).toContain('--private');
    expect(created()[0]).not.toContain('--public');
    expect(fs.existsSync(path.join(repoDir(), '.git'))).toBe(true);
    expect(result.stdout).toContain('tester/sync-ai-data');
    expect(result.stdout).toContain("'push'");
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toContain('tester/sync-ai-data');
    expect(result.questions[0]).toContain('PRIVATE');
  });

  it('leaves credential helpers alone when the protocol is ssh', async () => {
    await sandbox.run('A', ['init', '--yes'], { env: gh.env({ protocol: 'ssh' }) });

    expect(() => localHelpers()).toThrow();
  });

  it('wires the gh credential helper into the clone only when the protocol is https', async () => {
    const before = fs.readFileSync(sandbox.globalGitConfig, 'utf8');

    const result = await sandbox.run('A', ['init', '--yes'], { env: gh.env({ protocol: 'https' }) });

    expect(result.code).toBe(0);
    expect(localHelpers()).toEqual(['', '!gh auth git-credential']);
    expect(fs.readFileSync(sandbox.globalGitConfig, 'utf8')).toBe(before);
    const status = await sandbox.run('A', ['status'], { env: gh.env({ protocol: 'https' }) });
    expect(status.code).toBe(0);
  });

  it('uses the repository name given with --name', async () => {
    const result = await sandbox.run('A', ['init', '--name', 'my-config', '--yes'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(gh.repositories()).toEqual(['tester/my-config']);
  });

  it.each(['bad name', '-rf', '..', 'a/b', 'repo.git'])('rejects the repository name %j with exit 2', async (name) => {
    const result = await sandbox.run('A', ['init', `--name=${name}`, '--yes'], { env: gh.env() });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('invalid repository name');
    expect(gh.calls()).toEqual([]);
  });

  it('exits 3 without a terminal and without --yes, creating nothing', async () => {
    const result = await sandbox.run('A', ['init'], { confirm: false, env: gh.env() });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('--yes');
    expect(created()).toEqual([]);
    expect(fs.existsSync(repoDir())).toBe(false);
  });

  it('creates nothing and does not even ask with --dry-run', async () => {
    const result = await sandbox.run('A', ['init', '--dry-run'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[dry-run]');
    expect(result.stdout).toContain('tester/sync-ai-data');
    expect(result.questions).toEqual([]);
    expect(created()).toEqual([]);
    expect(fs.existsSync(repoDir())).toBe(false);
  });

  it('aborts loudly and does not clone when GitHub reports the new repository as not private', async () => {
    const result = await sandbox.run('A', ['init', '--yes'], { env: gh.env({ forcePublic: true }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('NOT private');
    expect(fs.existsSync(repoDir())).toBe(false);
  });

  it('does not touch gh when a clone already exists', async () => {
    await sandbox.run('A', ['init', sandbox.remote]);

    const result = await sandbox.run('A', ['init'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Already initialized');
    expect(gh.calls()).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('init without a URL when the repository already exists', () => {
  const SLUG = 'tester/sync-ai-data';
  let sandbox: Sandbox;
  let gh: FakeGh;

  beforeEach(() => {
    sandbox = new Sandbox({ autoList: true });
    gh = new FakeGh();
  });

  afterEach(() => {
    sandbox.cleanup();
    gh.cleanup();
  });

  const repoDir = (device: Device): string => path.join(sandbox.dataHome(device), 'repo');
  const created = (): string[] => gh.calls().filter((call) => call.startsWith('repo create'));

  /** Device A publishes its configuration to the repository that "already exists" on GitHub. */
  async function publishFromDeviceA(): Promise<void> {
    gh.seedRepository(SLUG);
    sandbox.write('A', 'CLAUDE.md', 'instructions from A\n');
    sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo\n');
    await sandbox.run('A', ['init', gh.remoteDir(SLUG)]);
    const pushed = await sandbox.run('A', ['push']);
    expect(pushed.code).toBe(0);
  }

  it('clones the existing private repository and installs its configuration', async () => {
    await publishFromDeviceA();

    const result = await sandbox.run('B', ['init'], { confirm: true, env: gh.env() });

    expect(result.code).toBe(0);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toContain(SLUG);
    expect(result.questions[0]).toContain('PRIVATE');
    expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
    expect(sandbox.read('B', 'skills/foo/SKILL.md')).toBe('skill foo\n');
    expect(created()).toEqual([]);
  });

  it('applies new files directly even with --yes, without asking again', async () => {
    await publishFromDeviceA();

    const result = await sandbox.run('B', ['init', '--yes'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(result.questions).toEqual([]);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
  });

  it('clones but never overwrites differing local files: they become conflicts until pull --yes', async () => {
    await publishFromDeviceA();
    sandbox.write('B', 'CLAUDE.md', 'local edit on B\n');

    const result = await sandbox.run('B', ['init', '--yes'], { env: gh.env() });

    expect(result.code).toBe(5);
    expect(result.stdout).toContain('! CLAUDE.md');
    expect(result.stderr).toContain('pull --yes');
    expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('local edit on B\n');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);

    const pulled = await sandbox.run('B', ['pull', '--yes']);

    expect(pulled.code).toBe(0);
    expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
    expect(sandbox.backupsOf('B', 'CLAUDE.md')).toHaveLength(1);
  });

  it('refuses a public repository and clones nothing', async () => {
    await publishFromDeviceA();
    gh.markPublic(SLUG);

    const result = await sandbox.run('B', ['init', '--yes'], { env: gh.env() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('PUBLIC');
    expect(result.stderr).toContain('init <url>');
    expect(fs.existsSync(repoDir('B'))).toBe(false);
    expect(sandbox.exists('B', 'CLAUDE.md')).toBe(false);
    expect(created()).toEqual([]);
  });

  it('exits 3 without a terminal and without --yes, cloning nothing', async () => {
    await publishFromDeviceA();

    const result = await sandbox.run('B', ['init'], { confirm: false, env: gh.env() });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain(`existing private repository ${SLUG}`);
    expect(result.stderr).toContain('--yes');
    expect(fs.existsSync(repoDir('B'))).toBe(false);
    expect(sandbox.exists('B', 'CLAUDE.md')).toBe(false);
  });

  it('only reports what it would do with --dry-run', async () => {
    await publishFromDeviceA();

    const result = await sandbox.run('B', ['init', '--dry-run'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[dry-run]');
    expect(result.stdout).toContain(SLUG);
    expect(result.questions).toEqual([]);
    expect(fs.existsSync(repoDir('B'))).toBe(false);
    expect(sandbox.exists('B', 'CLAUDE.md')).toBe(false);
  });

  it('clones an empty private repository without pulling and points to push', async () => {
    gh.seedRepository(SLUG);

    const result = await sandbox.run('B', ['init', '--yes'], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
    expect(result.stdout).toContain("'push'");
    expect(result.stdout).not.toContain('Installed');
    expect(created()).toEqual([]);
  });
});

describe('init with a URL', () => {
  let sandbox: Sandbox;
  let gh: FakeGh;

  beforeEach(() => {
    sandbox = new Sandbox();
    gh = new FakeGh();
  });

  afterEach(() => {
    sandbox.cleanup();
    gh.cleanup();
  });

  it('never calls gh', async () => {
    const result = await sandbox.run('A', ['init', sandbox.remote], { env: gh.env() });

    expect(result.code).toBe(0);
    expect(gh.calls()).toEqual([]);
  });

  it('rejects --name because it only names a repository to create', async () => {
    const result = await sandbox.run('A', ['init', sandbox.remote, '--name', 'x']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--name');
  });
});
