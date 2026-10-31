import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox, type Device } from './helpers/sandbox';

interface HookOutput {
  systemMessage?: string;
  hookSpecificOutput?: { hookEventName: string; additionalContext: string };
}

// Join so this file holds no literal secret.
const PRIVATE_KEY = ['-----BEGIN RSA PRIV', 'ATE KEY-----'].join('');

const minutesFromNow = (minutes: number): (() => Date) => {
  const base = Date.now();
  return () => new Date(base + minutes * 60_000);
};

describe('automatic push inside check', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = new Sandbox({ autoList: true });
    sandbox.write('A', 'CLAUDE.md', 'instructions v1\n');
    sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v1\n');
    await sandbox.run('A', ['init', sandbox.remote]);
    await sandbox.run('A', ['push']);
    await sandbox.run('B', ['init', sandbox.remote]);
    await sandbox.run('B', ['pull']);
  });
  afterEach(() => sandbox.cleanup());

  async function hook(
    device: Device,
    options: {
      event?: 'SessionStart' | 'UserPromptSubmit';
      session?: string;
      now?: () => Date;
      env?: Record<string, string>;
      args?: string[];
    } = {},
  ) {
    const result = await sandbox.run(device, ['check', '--hook', ...(options.args ?? [])], {
      stdin: JSON.stringify({ hook_event_name: options.event ?? 'UserPromptSubmit', session_id: options.session ?? 's1' }),
      now: options.now ?? minutesFromNow(10),
      ...(options.env ? { env: options.env } : {}),
    });
    const output = result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as HookOutput);
    return { ...result, output };
  }

  /** Lists an item of device A the way the user would, without the push that `autoList` adds. */
  const edit = async (rel: string, content: string): Promise<void> => {
    sandbox.write('A', rel, content);
    await sandbox.list('A', rel);
  };

  describe('when the rules are met', () => {
    it('publishes a quiet change and says so', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      const result = await hook('A');

      expect(result.code).toBe(0);
      expect(result.output?.systemMessage).toMatch(/^sync-ai: pushed 1 file \(commit [0-9a-f]{7,}\)$/);
      expect(sandbox.remoteHead()).not.toBe(head);
      expect(sandbox.remoteContains('skill foo v2')).toBe(true);
    });

    it('leaves the device in sync, so the next check is silent', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      await hook('A');

      const next = await hook('A', { session: 'other' });

      expect(next.stdout).toBe('');
    });

    it('works at SessionStart too', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');

      const result = await hook('A', { event: 'SessionStart' });

      expect(result.output?.systemMessage).toContain('pushed 1 file');
    });

    it('lets the other device pull what was pushed', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      await hook('A');

      await sandbox.run('B', ['pull']);

      expect(sandbox.read('B', 'skills/foo/SKILL.md')).toBe('skill foo v2\n');
    });
  });

  describe('when it must not push', () => {
    it('waits while the files were edited less than 5 minutes ago, and then pushes', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      const early = await hook('A', { now: minutesFromNow(4) });
      expect(early.stdout).toBe('');
      expect(sandbox.remoteHead()).toBe(head);

      const later = await hook('A', { now: minutesFromNow(6), session: 'later' });
      expect(later.output?.systemMessage).toContain('pushed 1 file');
      expect(sandbox.remoteHead()).not.toBe(head);
    });

    it('honours AGENT_SYNC_AUTO_PUSH_QUIET_MINUTES', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      await hook('A', { now: minutesFromNow(10), env: { AGENT_SYNC_AUTO_PUSH_QUIET_MINUTES: '30' } });

      expect(sandbox.remoteHead()).toBe(head);
    });

    it('does nothing and keeps the plain notice when AGENT_SYNC_AUTO_PUSH=0', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      const result = await hook('A', { env: { AGENT_SYNC_AUTO_PUSH: '0' } });

      expect(result.output?.systemMessage).toBe('sync-ai: 1 local change not pushed (run /sync-ai:sync)');
      expect(sandbox.remoteHead()).toBe(head);
    });

    it('does nothing with --dry-run, but says what it would do', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      const result = await hook('A', { args: ['--dry-run'] });

      expect(sandbox.remoteHead()).toBe(head);
      expect(result.output?.systemMessage).toMatch(/would push 1 file/);
    });

    it('does not push more than 20 files and says so', async () => {
      for (let index = 0; index < 21; index++) await edit(`commands/c${index}.md`, `command ${index}\n`);
      const head = sandbox.remoteHead();

      const result = await hook('A');

      expect(sandbox.remoteHead()).toBe(head);
      expect(result.output?.systemMessage).toContain('21');
      expect(result.output?.systemMessage).toContain('/sync-ai:sync');
    });

    it('honours AGENT_SYNC_AUTO_PUSH_MAX_FILES', async () => {
      await edit('commands/a.md', 'a\n');
      await edit('commands/b.md', 'b\n');
      const head = sandbox.remoteHead();

      await hook('A', { env: { AGENT_SYNC_AUTO_PUSH_MAX_FILES: '1' } });

      expect(sandbox.remoteHead()).toBe(head);
    });

    it('never deletes: a deleted file is reported as pending and stays in the repository', async () => {
      sandbox.remove('A', 'skills/foo/SKILL.md');
      const head = sandbox.remoteHead();

      const result = await hook('A');

      expect(sandbox.remoteHead()).toBe(head);
      expect(sandbox.remoteFiles()).toContain('skills/foo/SKILL.md');
      expect(result.output?.systemMessage).toContain('1 deletion pending, run /sync-ai:sync to confirm');
    });

    it('pushes the edits but keeps the deletions pending', async () => {
      await edit('commands/new.md', 'new\n');
      sandbox.remove('A', 'skills/foo/SKILL.md');

      const result = await hook('A');

      expect(sandbox.remoteFiles()).toContain('claude/commands/new.md');
      expect(sandbox.remoteFiles()).toContain('skills/foo/SKILL.md');
      expect(result.output?.systemMessage).toContain('pushed 1 file');
      expect(result.output?.systemMessage).toContain('1 deletion pending');
    });

    it('does not push when the repository has news: it pulls first', async () => {
      sandbox.write('B', 'skills/bar/SKILL.md', 'skill bar\n');
      await sandbox.run('B', ['push']);
      await edit('commands/mine.md', 'mine\n');

      const result = await hook('A', { event: 'UserPromptSubmit' });

      expect(sandbox.remoteContains('mine')).toBe(false);
      expect(result.output?.systemMessage).toContain('1 file');
    });

    it('does not push while there are conflicts', async () => {
      sandbox.write('B', 'skills/foo/SKILL.md', 'from B\n');
      await sandbox.run('B', ['push']);
      await edit('skills/foo/SKILL.md', 'from A\n');
      await edit('commands/mine.md', 'mine\n');
      const head = sandbox.remoteHead();

      const result = await hook('A');

      expect(sandbox.remoteHead()).toBe(head);
      expect(result.output?.systemMessage).toContain('conflict');
    });

    it('does not push a device that never pulled or pushed', async () => {
      const other = new Sandbox({ autoList: true });
      try {
        other.write('A', 'commands/mine.md', 'mine\n');
        await other.run('A', ['init', other.remote]);
        const result = await other.run('A', ['check', '--hook'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's' }),
          now: minutesFromNow(10),
        });
        expect(result.stdout).toContain('no sync baseline');
        expect(other.remoteFiles()).toEqual([]);
      } finally {
        other.cleanup();
      }
    });
  });

  describe('scanner', () => {
    it.each([
      ['a secret', `${PRIVATE_KEY}\nnot-a-real-key\n`],
      ['a password', 'password = "hunter2secret"\n'],
      ['personal data', 'contact me at jane.doe@corp-mail.io\n'],
    ])('blocks %s and reports where, once, without printing it', async (_name, content) => {
      await edit('commands/leak.md', content);
      const head = sandbox.remoteHead();

      const first = await hook('A');
      const second = await hook('A', { now: minutesFromNow(11) });

      expect(sandbox.remoteHead()).toBe(head);
      expect(first.output?.systemMessage).toContain('auto-push skipped');
      expect(first.output?.systemMessage).toContain('commands/leak.md:');
      expect(first.stdout).not.toContain('hunter2secret');
      expect(first.stdout).not.toContain('corp-mail');
      expect(first.stdout).not.toContain('not-a-real-key');
      expect(second.stdout).toBe('');
    });

    it('blocks the whole push, including clean files', async () => {
      await edit('commands/clean.md', 'clean\n');
      await edit('commands/leak.md', 'password = "hunter2secret"\n');
      const head = sandbox.remoteHead();

      await hook('A');

      expect(sandbox.remoteHead()).toBe(head);
    });

    it('is cleared with the allow marker', async () => {
      await edit('commands/doc.md', 'password = "hunter2secret" # sync-ai:allow\n');

      const result = await hook('A');

      expect(result.output?.systemMessage).toContain('pushed 1 file');
    });

    it('blocks the OS user name of the device and the words of scan-words.txt', async () => {
      sandbox.writeDataFile('A', 'scan-words.txt', '# my words\nacmecorp\n');
      await edit('commands/who.md', 'built for AcmeCorp\n');
      const head = sandbox.remoteHead();

      const result = await hook('A');

      expect(sandbox.remoteHead()).toBe(head);
      expect(result.output?.systemMessage).toContain('commands/who.md:1');
    });
  });

  describe('failures', () => {
    it('stays silent and does not retry on every prompt when the remote is down', async () => {
      await edit('skills/foo/SKILL.md', 'skill foo v2\n');
      sandbox.disconnectRemote();

      const result = await hook('A');
      sandbox.reconnectRemote();

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(sandbox.remoteContains('skill foo v2')).toBe(false);
    });
  });
});
