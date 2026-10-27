import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGh, pathWithoutGh } from './helpers/fake-gh';
import { Sandbox } from './helpers/sandbox';

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

  it('never reuses an existing repository and creates nothing', async () => {
    gh.seedRepository('tester/sync-ai-data');

    const result = await sandbox.run('A', ['init', '--yes'], { env: gh.env() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('already exists');
    expect(result.stderr).toContain('--name');
    expect(created()).toEqual([]);
    expect(fs.existsSync(repoDir())).toBe(false);
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
