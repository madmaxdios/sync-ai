import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

// Fake private key header, built at runtime so this file holds no literal secret.
const PRIVATE_KEY_HEADER = ['-----BEGIN RSA PRIV', 'ATE KEY-----'].join('');

/**
 * One end-to-end scenario between two devices. Steps depend on the state left by
 * the previous ones, so the `it` blocks run in order and share the sandbox.
 */
describe('agent-sync between two devices', () => {
  const sandbox = new Sandbox();
  afterAll(() => sandbox.cleanup());

  beforeAll(() => {
    sandbox.write('A', 'CLAUDE.md', 'instructions v1\n');
    sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo\n');
    sandbox.write('A', 'skills/foo/SKILL.md.backup-20200101-000000', 'old copy\n');
    sandbox.write('A', 'commands/hello.md', 'hello v1\n');
    sandbox.write('A', 'agents/a.md', 'agent a\n');
    sandbox.write('A', '.credentials.json', '{"token":"SENTINEL_CRED"}\n');
    sandbox.write('A', 'settings.json', '{"env":"SENTINEL_SETTINGS"}\n');
    sandbox.write('A', 'history.jsonl', 'SENTINEL_HISTORY\n');
    sandbox.write('A', 'projects/p/session.jsonl', 'SENTINEL_PROJECT\n');
    sandbox.write('A', 'plugins/p.json', 'SENTINEL_PLUGIN\n');
  });

  describe('init and first push (device A)', () => {
    it('init clones the repo', async () => {
      await sandbox.run('A', ['init', sandbox.remote]);
      expect(fs.existsSync(`${sandbox.dataHome('A')}/repo/.git`)).toBe(true);
    });

    it('init twice is idempotent', async () => {
      const result = await sandbox.run('A', ['init', sandbox.remote]);
      expect(result.output).toContain('Already initialized');
    });

    it('push exits 0', async () => {
      const result = await sandbox.run('A', ['push']);
      expect(result.code).toBe(0);
    });

    it.each(['claude/CLAUDE.md', 'claude/skills/foo/SKILL.md', 'claude/commands/hello.md', 'claude/agents/a.md'])(
      'remote has %s',
      (file) => {
        expect(sandbox.remoteFiles()).toContain(file);
      },
    );

    it.each(['settings.json', '.credentials.json', 'history.jsonl', 'projects', 'plugins', 'backup-'])(
      'remote never has %s',
      (fragment) => {
        expect(sandbox.remoteFiles().filter((file) => file.includes(fragment))).toEqual([]);
      },
    );

    it('no denied content in any remote blob', () => {
      expect(sandbox.remoteContains('SENTINEL')).toBe(false);
    });

    it('second push reports no changes', async () => {
      const result = await sandbox.run('A', ['push']);
      expect(result.output).toContain('No changes');
    });

    it('status after push is up to date', async () => {
      const result = await sandbox.run('A', ['status']);
      expect(result.output).toContain('up to date');
    });
  });

  describe('pull on a fresh device (device B)', () => {
    it('pull exits 0 without confirmation for new files', async () => {
      await sandbox.run('B', ['init', sandbox.remote]);
      const result = await sandbox.run('B', ['pull']);
      expect(result.code).toBe(0);
    });

    it('B received CLAUDE.md', () => {
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions v1\n');
    });

    it('B received the skill', () => {
      expect(sandbox.exists('B', 'skills/foo/SKILL.md')).toBe(true);
    });

    it('B did not get settings.json', () => {
      expect(sandbox.exists('B', 'settings.json')).toBe(false);
    });

    it('B did not get credentials', () => {
      expect(sandbox.exists('B', '.credentials.json')).toBe(false);
    });

    it('pull again is a no-op', async () => {
      const result = await sandbox.run('B', ['pull']);
      expect(result.output).toContain('Everything is up to date');
    });
  });

  describe('overwrite confirmation and backups', () => {
    it('status shows pending pull', async () => {
      sandbox.write('B', 'CLAUDE.md', 'B local edit\n');
      sandbox.write('A', 'CLAUDE.md', 'instructions v2\n');
      await sandbox.run('A', ['push']);
      const result = await sandbox.run('B', ['status']);
      expect(result.output).toContain("new commit(s) on the remote (run 'pull')");
    });

    it('pull without --yes on a non-interactive session exits 3', async () => {
      const result = await sandbox.run('B', ['pull']);
      expect(result.code).toBe(3);
    });

    it('local file untouched after refusal', () => {
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('B local edit\n');
    });

    it('dry-run pull exits 0', async () => {
      const result = await sandbox.run('B', ['pull', '--dry-run']);
      expect(result.code).toBe(0);
    });

    it('dry-run leaves local file untouched', () => {
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('B local edit\n');
    });

    it('pull --yes exits 0', async () => {
      const result = await sandbox.run('B', ['pull', '--yes']);
      expect(result.code).toBe(0);
    });

    it('local file overwritten', () => {
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions v2\n');
    });

    it('backup keeps the previous content', () => {
      const [backup] = sandbox.backupsOf('B', 'CLAUDE.md');
      expect(backup).toBeDefined();
      expect(fs.readFileSync(backup ?? '', 'utf8')).toBe('B local edit\n');
    });

    it('backup file is not listed for publication', async () => {
      const result = await sandbox.run('B', ['push', '--dry-run']);
      expect(result.output).not.toContain('backup-');
    });
  });

  describe('secret scan', () => {
    it('push with secrets exits 4, keeps the remote untouched and never prints the secret', async () => {
      sandbox.write('A', 'skills/bad/SKILL.md', `${PRIVATE_KEY_HEADER}\npassword=hunter2secret\n`);
      const before = sandbox.remoteHead();
      const result = await sandbox.run('A', ['push']);

      expect(result.code).toBe(4);
      expect(sandbox.remoteHead()).toBe(before);
      expect(result.output).toContain('skills/bad/SKILL.md');
      expect(result.output).not.toContain('hunter2secret');
      sandbox.remove('A', 'skills/bad');
    });
  });

  describe('dry-run push and mirrored deletions', () => {
    it('dry-run push lists the change and does not publish', async () => {
      sandbox.write('A', 'commands/hello.md', 'hello v2\n');
      const before = sandbox.remoteHead();
      const result = await sandbox.run('A', ['push', '--dry-run']);

      expect(result.code).toBe(0);
      expect(result.output).toContain('commands/hello.md');
      expect(sandbox.remoteHead()).toBe(before);
    });

    it('real push changes the remote head', async () => {
      const before = sandbox.remoteHead();
      await sandbox.run('A', ['push']);
      expect(sandbox.remoteHead()).not.toBe(before);
    });

    it('deleted file is removed from the remote', async () => {
      sandbox.remove('A', 'commands/hello.md');
      await sandbox.run('A', ['push']);
      expect(sandbox.remoteFiles()).not.toContain('claude/commands/hello.md');
    });

    it('pull never deletes local files', async () => {
      await sandbox.run('B', ['pull', '--yes']);
      expect(sandbox.exists('B', 'commands/hello.md')).toBe(true);
    });
  });

  describe('push is refused while behind', () => {
    it('exits 1, tells to pull first and leaves the remote untouched', async () => {
      sandbox.write('A', 'CLAUDE.md', 'instructions v3\n');
      await sandbox.run('A', ['push']);
      const before = sandbox.remoteHead();
      sandbox.write('B', 'agents/b.md', 'B change\n');

      const result = await sandbox.run('B', ['push']);

      expect(result.code).toBe(1);
      expect(result.output).toContain("Run 'pull' before 'push'");
      expect(sandbox.remoteHead()).toBe(before);
    });
  });

  describe('usage errors', () => {
    it('unknown command exits 2', async () => {
      const result = await sandbox.run('A', ['bogus']);
      expect(result.code).toBe(2);
    });

    it('unknown agent exits 1', async () => {
      const result = await sandbox.run('A', ['status'], { agent: 'nope' });
      expect(result.code).toBe(1);
    });
  });
});
