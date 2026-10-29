import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox, type Device } from './helpers/sandbox';

interface HookOutput {
  systemMessage?: string;
  hookSpecificOutput?: { hookEventName: string; additionalContext: string };
}

const t0 = new Date('2026-10-29T10:00:00Z');
const minutesAfter = (minutes: number): (() => Date) => () => new Date(t0.getTime() + minutes * 60_000);

describe('check', () => {
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

  /** Runs `check --hook` the way the agent does: hook JSON on stdin, hook JSON on stdout. */
  async function hook(
    device: Device,
    event: 'SessionStart' | 'UserPromptSubmit',
    options: { session?: string; now?: () => Date; env?: Record<string, string>; args?: string[] } = {},
  ) {
    const result = await sandbox.run(device, ['check', '--hook', ...(options.args ?? [])], {
      stdin: JSON.stringify({ hook_event_name: event, session_id: options.session ?? 's1' }),
      now: options.now ?? (() => t0),
      // These tests are about the notices; the automatic push has its own suite.
      env: { AGENT_SYNC_AUTO_PUSH: '0', ...options.env },
    });
    const output = result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as HookOutput);
    return { ...result, output };
  }

  async function pushFromB(rel: string, content: string): Promise<void> {
    sandbox.write('B', rel, content);
    expect((await sandbox.run('B', ['push'])).code).toBe(0);
  }

  describe('when everything is in sync', () => {
    it.each(['SessionStart', 'UserPromptSubmit'] as const)('says nothing at %s and exits 0', async (event) => {
      const result = await hook('A', event);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });
  });

  describe('local changes', () => {
    it('reports an edited skill and asks the agent to offer a push, never to push', async () => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');

      const result = await hook('A', 'UserPromptSubmit');

      expect(result.code).toBe(0);
      expect(result.output?.systemMessage).toBe('sync-ai: 1 local change not pushed (run /sync-ai:sync)');
      expect(result.output?.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
      expect(result.output?.hookSpecificOutput?.additionalContext).toContain('never push without their confirmation');
    });

    it('never publishes anything', async () => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');
      const head = sandbox.remoteHead();

      await hook('A', 'SessionStart');
      await hook('A', 'UserPromptSubmit');

      expect(sandbox.remoteHead()).toBe(head);
    });

    it('counts new files and deleted files too', async () => {
      sandbox.write('A', 'skills/new/SKILL.md', 'new\n');
      await sandbox.list('A', 'skills/new/SKILL.md');
      sandbox.remove('A', 'skills/foo/SKILL.md');

      const result = await hook('A', 'UserPromptSubmit');

      expect(result.output?.systemMessage).toContain('2 local changes not pushed');
    });

    it('lists detected additions, modifications and deletions for a manual sync', async () => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');
      sandbox.write('A', 'skills/new/SKILL.md', 'new\n');
      await sandbox.list('A', 'skills/new/SKILL.md');
      sandbox.remove('A', 'CLAUDE.md');

      const result = await sandbox.run('A', ['sync']);

      expect(result.output).toContain('Changes to publish (local → repository):');
      expect(result.output).toContain('  + skills/new/SKILL.md');
      expect(result.output).toContain('  ~ skills/foo/SKILL.md');
      expect(result.output).toContain('  - CLAUDE.md');
    });
  });

  describe('changes pushed from another device', () => {
    beforeEach(async () => {
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');
    });

    it('pulls them automatically at the start of a chat and says so', async () => {
      const result = await hook('A', 'SessionStart');

      expect(result.code).toBe(0);
      expect(sandbox.read('A', 'skills/bar/SKILL.md')).toBe('skill bar\n');
      expect(result.output?.systemMessage).toBe('sync-ai: pulled 1 file from the repository');
      expect(result.output?.hookSpecificOutput).toBeUndefined();
      expect((await sandbox.run('A', ['status'])).stdout).toContain('no differences');
    });

    it('only informs when a prompt is sent, without touching any file', async () => {
      const result = await hook('A', 'UserPromptSubmit');

      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
      expect(result.output?.systemMessage).toBe(
        'sync-ai: the repository has 1 file change (1 newer commit) (run /sync-ai:sync)',
      );
      expect(result.output?.hookSpecificOutput?.additionalContext).toContain('offer /sync-ai:sync');
    });

    it('keeps backups when it replaces a file that changed in the repository', async () => {
      await pushFromB('skills/foo/SKILL.md', 'skill foo from B\n');

      await hook('A', 'SessionStart');

      expect(sandbox.read('A', 'skills/foo/SKILL.md')).toBe('skill foo from B\n');
      expect(sandbox.backupsOf('A', 'skills/foo/SKILL.md')).toHaveLength(1);
    });

    it('reports a pull and the local changes together', async () => {
      sandbox.write('A', 'commands/mine.md', 'mine\n');
      await sandbox.list('A', 'commands/mine.md');

      const result = await hook('A', 'SessionStart');

      expect(result.output?.systemMessage).toBe(
        'sync-ai: pulled 1 file from the repository; 1 local change not pushed (run /sync-ai:sync)',
      );
      expect(sandbox.read('A', 'skills/bar/SKILL.md')).toBe('skill bar\n');
    });
  });

  describe('conflicts', () => {
    beforeEach(async () => {
      sandbox.write('A', 'CLAUDE.md', 'instructions from A\n');
      sandbox.write('B', 'CLAUDE.md', 'instructions from B\n');
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');
    });

    it('does not pull anything at the start of a chat and points to resolve', async () => {
      const result = await hook('A', 'SessionStart');

      expect(result.code).toBe(0);
      expect(result.output?.systemMessage).toContain('1 conflict, run /sync-ai:resolve');
      expect(sandbox.read('A', 'CLAUDE.md')).toBe('instructions from A\n');
      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
      expect(sandbox.backupsOf('A', 'CLAUDE.md')).toEqual([]);
    });
  });

  describe('a device without a baseline', () => {
    beforeEach(() => {
      sandbox.removeDataFile('A', 'state.json');
    });

    it('does not pull and reports it once at the start of a chat', async () => {
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');

      const first = await hook('A', 'SessionStart');
      const again = await hook('A', 'SessionStart');
      const prompt = await hook('A', 'UserPromptSubmit');

      expect(first.output?.systemMessage).toContain('no sync baseline');
      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
      expect(again.stdout).toBe('');
      expect(prompt.stdout).toBe('');
      expect(sandbox.dataFile('A', 'state.json')).toBeUndefined();
    });
  });

  describe('when the remote cannot be reached', () => {
    beforeEach(() => {
      sandbox.disconnectRemote();
    });
    afterEach(() => {
      sandbox.reconnectRemote();
    });

    it('is silent and exits 0 when nothing changed locally', async () => {
      const result = await hook('A', 'SessionStart');

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('still reports local changes, which need no network', async () => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');

      const result = await hook('A', 'SessionStart');

      expect(result.output?.systemMessage).toBe('sync-ai: 1 local change not pushed (run /sync-ai:sync)');
    });
  });

  describe('network throttling', () => {
    it('does not contact the remote again within the interval, and does after it', async () => {
      expect((await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) })).stdout).toBe('');
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');

      const inside = await hook('A', 'UserPromptSubmit', { now: minutesAfter(5) });
      const after = await hook('A', 'UserPromptSubmit', { now: minutesAfter(11) });

      expect(inside.stdout).toBe('');
      expect(after.output?.systemMessage).toContain('the repository has 1 file change');
    });

    it('always checks the remote at the start of a chat', async () => {
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');

      const result = await hook('A', 'SessionStart', { now: minutesAfter(1), session: 's2' });

      expect(result.output?.systemMessage).toBe('sync-ai: pulled 1 file from the repository');
    });

    it('does not even try the network inside the interval when the remote is down', async () => {
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });
      sandbox.disconnectRemote();
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');

      const result = await hook('A', 'UserPromptSubmit', { now: minutesAfter(2) });

      expect(result.output?.systemMessage).toBe('sync-ai: 1 local change not pushed (run /sync-ai:sync)');
      sandbox.reconnectRemote();
    });

    it('can be tuned with AGENT_SYNC_CHECK_INTERVAL_MINUTES', async () => {
      const env = { AGENT_SYNC_CHECK_INTERVAL_MINUTES: '0' };
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0), env });
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');

      const result = await hook('A', 'UserPromptSubmit', { now: minutesAfter(1), env });

      expect(result.output?.systemMessage).toContain('the repository has 1 file change');
    });

    it('remembers the last check in the data directory', async () => {
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });

      expect(sandbox.dataFile('A', 'check-cache.json')).toContain('"lastRemoteCheckAt": "2026-10-29T10:00:00.000Z"');
    });
  });

  describe('repeated messages', () => {
    beforeEach(() => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');
    });

    it('announces the same situation only once per chat', async () => {
      const first = await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });
      const second = await hook('A', 'UserPromptSubmit', { now: minutesAfter(1) });

      expect(first.output?.systemMessage).toContain('1 local change');
      expect(second.stdout).toBe('');
    });

    it('announces again when the situation changes', async () => {
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });
      sandbox.write('A', 'skills/new/SKILL.md', 'new\n');
      await sandbox.list('A', 'skills/new/SKILL.md');

      const result = await hook('A', 'UserPromptSubmit', { now: minutesAfter(1) });

      expect(result.output?.systemMessage).toContain('2 local changes');
    });

    it('announces again after 30 minutes, and in another chat', async () => {
      await hook('A', 'UserPromptSubmit', { now: minutesAfter(0) });

      const later = await hook('A', 'UserPromptSubmit', { now: minutesAfter(31) });
      const otherChat = await hook('A', 'UserPromptSubmit', { now: minutesAfter(32), session: 'another' });

      expect(later.output?.systemMessage).toContain('1 local change');
      expect(otherChat.output?.systemMessage).toContain('1 local change');
    });
  });

  describe('hook output', () => {
    beforeEach(() => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');
    });

    it.each(['SessionStart', 'UserPromptSubmit'] as const)('is one JSON object with the %s event name', async (event) => {
      const result = await hook('A', event);

      expect(result.stdout.trim().split('\n')).toHaveLength(1);
      expect(Object.keys(result.output ?? {}).sort()).toEqual(['hookSpecificOutput', 'systemMessage']);
      expect(result.output?.hookSpecificOutput?.hookEventName).toBe(event);
    });

    it('carries only a user message for events other than the two it serves', async () => {
      const result = await sandbox.run('A', ['check', '--hook'], {
        stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }),
        now: () => t0,
      });

      expect(JSON.parse(result.stdout)).toEqual({
        systemMessage: 'sync-ai: 1 local change not pushed (run /sync-ai:sync)',
      });
    });

    it('treats unreadable stdin as another event and still exits 0', async () => {
      const result = await sandbox.run('A', ['check', '--hook'], { stdin: 'not json', now: () => t0 });

      expect(result.code).toBe(0);
      expect(Object.keys(JSON.parse(result.stdout) as object)).toEqual(['systemMessage']);
    });
  });

  describe('switches', () => {
    beforeEach(async () => {
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v2\n');
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');
    });

    it('AGENT_SYNC_CHECK=0 turns it off completely', async () => {
      const result = await hook('A', 'SessionStart', { env: { AGENT_SYNC_CHECK: '0' } });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
      expect(sandbox.dataFile('A', 'check-cache.json')).toBeUndefined();
    });

    it('--dry-run reports what it would do and changes nothing', async () => {
      const state = sandbox.dataFile('A', 'state.json');

      const result = await hook('A', 'SessionStart', { args: ['--dry-run'] });

      expect(result.output?.systemMessage).toBe(
        '[dry-run] sync-ai: would pull 1 file from the repository; 1 local change not pushed (run /sync-ai:sync)',
      );
      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
      expect(sandbox.read('A', 'skills/foo/SKILL.md')).toBe('skill foo v2\n');
      expect(sandbox.dataFile('A', 'state.json')).toBe(state);
      expect(sandbox.dataFile('A', 'check-cache.json')).toBeUndefined();
    });
  });

  describe('manual runs without --hook', () => {
    it('print a plain line and say when everything is in sync', async () => {
      expect((await sandbox.run('A', ['check'])).stdout).toBe('sync-ai: in sync.');
      expect((await sandbox.run('A', ['check', '--quiet'])).stdout).toBe('');
    });

    it('print the finding as plain text and check the remote every time', async () => {
      await pushFromB('skills/bar/SKILL.md', 'skill bar\n');

      const result = await sandbox.run('A', ['check'], { now: () => t0 });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        'Changes to pull (repository → local):\n' +
          '  + skills/bar/SKILL.md\n' +
          'sync-ai: the repository has 1 file change (1 newer commit) (run /sync-ai:sync)',
      );
      expect(sandbox.exists('A', 'skills/bar/SKILL.md')).toBe(false);
    });
  });

  describe('before the data repository exists', () => {
    it('is silent and creates nothing', async () => {
      const fresh = new Sandbox({ autoList: true });
      try {
        const result = await fresh.run('A', ['check', '--hook'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1' }),
        });

        expect(result.code).toBe(0);
        expect(result.stdout).toBe('');
        expect(fresh.dataFile('A', 'check-cache.json')).toBeUndefined();
      } finally {
        fresh.cleanup();
      }
    });
  });
});
