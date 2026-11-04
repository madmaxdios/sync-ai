import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGh, pathWithoutGh } from './helpers/fake-gh';
import { Sandbox, type Device } from './helpers/sandbox';

const SLUG = 'tester/sync-ai-data';

describe.skipIf(process.platform === 'win32')('first sync through the GitHub CLI', () => {
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

  const repoDir = (device: Device = 'A'): string => path.join(sandbox.dataHome(device), 'repo');
  const created = (): string[] => gh.calls().filter((call) => call.startsWith('repo create'));
  const localHelpers = (): string[] =>
    execFileSync('git', ['-C', repoDir(), 'config', '--local', '--get-all', 'credential.helper'], { encoding: 'utf8' })
      .split('\n')
      .slice(0, -1);

  /** Device A publishes its configuration to the repository that "already exists" on GitHub. */
  async function publishFromDeviceA(): Promise<void> {
    gh.seedRepository(SLUG);
    sandbox.write('A', 'CLAUDE.md', 'instructions from A\n');
    sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo\n');
    await sandbox.run('A', ['sync'], { env: { AGENT_SYNC_REPO_URL: gh.remoteDir(SLUG) } });
    expect((await sandbox.run('A', ['push'])).code).toBe(0);
  }

  describe('when the repository does not exist', () => {
    it('reports that gh is missing and creates nothing', async () => {
      const result = await sandbox.run('A', ['sync', '--yes'], { env: { PATH: pathWithoutGh() } });

      expect(result.stderr).toContain('GitHub CLI (gh)');
      expect(result.stderr).toContain('AGENT_SYNC_REPO_URL');
      expect(fs.existsSync(repoDir())).toBe(false);
    });

    it('points to gh auth login when gh is not authenticated', async () => {
      const result = await sandbox.run('A', ['sync', '--yes'], { env: gh.env({ authenticated: false }) });

      expect(result.stderr).toContain('gh auth login');
      expect(created()).toEqual([]);
      expect(fs.existsSync(repoDir())).toBe(false);
    });

    it('creates a private repository after asking, then clones it', async () => {
      const result = await sandbox.run('A', ['sync'], { confirm: true, env: gh.env({ protocol: 'ssh' }) });

      expect(gh.repositories()).toEqual([SLUG]);
      expect(created()).toHaveLength(1);
      expect(created()[0]).toContain('--private');
      expect(fs.existsSync(path.join(repoDir(), '.git'))).toBe(true);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]).toContain(SLUG);
      expect(result.questions[0]).toContain('PRIVATE');
      expect(() => localHelpers()).toThrow();
    });

    it('wires the gh credential helper into the clone only when the protocol is https', async () => {
      const before = fs.readFileSync(sandbox.globalGitConfig, 'utf8');

      await sandbox.run('A', ['sync', '--yes'], { env: gh.env({ protocol: 'https' }) });

      expect(localHelpers()).toEqual(['', '!gh auth git-credential']);
      expect(fs.readFileSync(sandbox.globalGitConfig, 'utf8')).toBe(before);
    });

    it('uses the repository name given with --name', async () => {
      await sandbox.run('A', ['sync', '--name', 'my-config', '--yes'], { env: gh.env() });

      expect(gh.repositories()).toEqual(['tester/my-config']);
    });

    it.each(['bad name', '-rf', '..', 'a/b', 'repo.git'])('rejects the repository name %j', async (name) => {
      const result = await sandbox.run('A', ['sync', `--name=${name}`, '--yes'], { env: gh.env() });

      expect(result.stderr).toContain('invalid repository name');
      expect(gh.calls()).toEqual([]);
    });

    it('creates nothing without a terminal and without --yes', async () => {
      const result = await sandbox.run('A', ['sync'], { confirm: false, env: gh.env() });

      expect(result.stderr).toContain('--yes');
      expect(created()).toEqual([]);
      expect(fs.existsSync(repoDir())).toBe(false);
    });

    it('creates nothing and does not even ask with --dry-run', async () => {
      const result = await sandbox.run('A', ['sync', '--dry-run'], { env: gh.env() });

      expect(result.stdout).toContain('[dry-run]');
      expect(result.questions).toEqual([]);
      expect(created()).toEqual([]);
      expect(fs.existsSync(repoDir())).toBe(false);
    });

    it('aborts and does not clone when GitHub reports the new repository as not private', async () => {
      const result = await sandbox.run('A', ['sync', '--yes'], { env: gh.env({ forcePublic: true }) });

      expect(result.stderr).toContain('NOT private');
      expect(fs.existsSync(repoDir())).toBe(false);
    });
  });

  describe('when the repository already exists', () => {
    it('clones it and installs its configuration without asking', async () => {
      await publishFromDeviceA();

      const result = await sandbox.run('B', ['sync'], { env: gh.env() });

      expect(result.questions).toEqual([]);
      expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
      expect(sandbox.read('B', 'skills/foo/SKILL.md')).toBe('skill foo\n');
      expect(created()).toEqual([]);
    });

    it('never overwrites differing local files: they become conflicts until pull --yes', async () => {
      await publishFromDeviceA();
      sandbox.write('B', 'CLAUDE.md', 'local edit on B\n');

      const result = await sandbox.run('B', ['sync'], { env: gh.env() });

      expect(result.stdout).toContain('! CLAUDE.md');
      expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('local edit on B\n');

      expect((await sandbox.run('B', ['pull', '--yes'])).code).toBe(0);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
      expect(sandbox.backupsOf('B', 'CLAUDE.md')).toHaveLength(1);
    });

    it('refuses a public repository and clones nothing', async () => {
      await publishFromDeviceA();
      gh.markPublic(SLUG);

      const result = await sandbox.run('B', ['sync'], { env: gh.env() });

      expect(result.stderr).toContain('PUBLIC');
      expect(fs.existsSync(repoDir('B'))).toBe(false);
      expect(sandbox.exists('B', 'CLAUDE.md')).toBe(false);
      expect(created()).toEqual([]);
    });

    it('only reports what it would do with --dry-run', async () => {
      await publishFromDeviceA();

      const result = await sandbox.run('B', ['sync', '--dry-run'], { env: gh.env() });

      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain(SLUG);
      expect(fs.existsSync(repoDir('B'))).toBe(false);
    });

    it('clones an empty private repository without pulling', async () => {
      gh.seedRepository(SLUG);

      const result = await sandbox.run('B', ['sync'], { env: gh.env() });

      expect(fs.existsSync(path.join(repoDir('B'), '.git'))).toBe(true);
      expect(result.stdout).not.toContain('Installed');
      expect(created()).toEqual([]);
    });
  });

  describe('from the agent hook', () => {
    const hook = (device: Device, env: Record<string, string | undefined>, event = 'SessionStart') =>
      sandbox.run(device, ['check', '--hook'], {
        stdin: JSON.stringify({ hook_event_name: event, session_id: 's1' }),
        env,
      });

    it('clones the existing repository, installs its files and answers with one hook message', async () => {
      await publishFromDeviceA();

      const result = await hook('B', gh.env());

      expect((JSON.parse(result.stdout) as { systemMessage: string }).systemMessage).toContain('cloned');
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions from A\n');
    });

    it('never creates the repository', async () => {
      const result = await hook('A', gh.env());

      expect((JSON.parse(result.stdout) as { systemMessage: string }).systemMessage).toContain('does not exist yet');
      expect(created()).toEqual([]);
      expect(fs.existsSync(repoDir())).toBe(false);
    });
  });
});

describe('first sync with AGENT_SYNC_REPO_URL', () => {
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

  it('clones that repository and never calls gh', async () => {
    const result = await sandbox.connect('A', { env: gh.env() });

    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(sandbox.dataHome('A'), 'repo', '.git'))).toBe(true);
    expect(gh.calls()).toEqual([]);
  });

  it('rejects --name because it only names a repository to create', async () => {
    const result = await sandbox.run('A', ['sync', '--name', 'x'], { env: { AGENT_SYNC_REPO_URL: sandbox.remote } });

    expect(result.stderr).toContain('--name');
  });

  it('works from the hook at the start of a session', async () => {
    const result = await sandbox.run('A', ['check', '--hook'], {
      stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1' }),
      env: { AGENT_SYNC_REPO_URL: sandbox.remote },
    });

    expect((JSON.parse(result.stdout) as { systemMessage: string }).systemMessage).toContain('cloned');
    expect(fs.existsSync(path.join(sandbox.dataHome('A'), 'repo', '.git'))).toBe(true);
  });
});
