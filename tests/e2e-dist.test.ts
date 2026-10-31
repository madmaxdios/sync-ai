import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, type Device } from './helpers/sandbox';

const bundle = path.resolve(import.meta.dirname, '..', 'dist', 'agent-sync.mjs');

// Fake private key header, built at runtime so this file holds no literal secret.
const PRIVATE_KEY_HEADER = ['-----BEGIN RSA PRIV', 'ATE KEY-----'].join('');

/**
 * End-to-end scenario against the built bundle, run as a separate process per command,
 * with two fake devices sharing a local bare git remote. Steps depend on the state left
 * by the previous ones, so the `it` blocks run in order.
 */
describe('built bundle between two devices', () => {
  const sandbox = new Sandbox();
  const cli = (device: Device, ...args: string[]) => sandbox.runBundle(bundle, device, args);

  beforeAll(() => {
    if (!fs.existsSync(bundle)) {
      throw new Error(`Missing ${bundle}. Run "npm run build" in sync-ai/ before the tests.`);
    }
  });
  afterAll(() => sandbox.cleanup());

  it('--help exits 0 and an unknown command exits 2', async () => {
    expect((await cli('A', '--help')).code).toBe(0);
    expect((await cli('A', 'frobnicate')).code).toBe(2);
  });

  describe('first push from A and first pull on B', () => {
    beforeAll(() => {
      sandbox.write('A', 'CLAUDE.md', 'instructions v1\n');
      sandbox.write('A', 'skills/foo/SKILL.md', 'skill foo v1\n');
      sandbox.write('A', 'commands/hello.md', 'hello v1\n');
      sandbox.write('A', 'agents/a.md', 'agent a v1\n');
    });

    it('A init and push exit 0', async () => {
      expect((await cli('A', 'init', sandbox.remote)).code).toBe(0);
      expect((await cli('A', 'push')).code).toBe(0);
      expect(sandbox.remoteFiles()).toEqual(['skills/MAIN-SKILL.md']);
      expect((await cli('A', 'add', 'skill', 'foo')).code).toBe(0);
      expect((await cli('A', 'add', 'command', 'hello.md')).code).toBe(0);
      expect((await cli('A', 'add', 'agent', 'a.md')).code).toBe(0);
      expect((await cli('A', 'push')).code).toBe(0);
      expect(sandbox.remoteFiles()).toContain('skills/foo/SKILL.md');
    });

    it('B init and pull bring the files', async () => {
      expect((await cli('B', 'init', sandbox.remote)).code).toBe(0);
      expect((await cli('B', 'pull')).code).toBe(0);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions v1\n');
      expect(sandbox.read('B', 'skills/foo/SKILL.md')).toBe('skill foo v1\n');
      expect(sandbox.read('B', 'commands/hello.md')).toBe('hello v1\n');
    });
  });

  describe('different files edited on each device', () => {
    it('both changes travel without conflict', async () => {
      sandbox.write('A', 'commands/hello.md', 'hello v2 from A\n');
      expect((await cli('A', 'push')).code).toBe(0);

      sandbox.write('B', 'skills/foo/SKILL.md', 'skill foo v2 from B\n');
      expect((await cli('B', 'pull')).code).toBe(0);
      expect(sandbox.read('B', 'commands/hello.md')).toBe('hello v2 from A\n');
      expect(sandbox.read('B', 'skills/foo/SKILL.md')).toBe('skill foo v2 from B\n');

      expect((await cli('B', 'push')).code).toBe(0);
      expect((await cli('A', 'pull')).code).toBe(0);
      expect(sandbox.read('A', 'skills/foo/SKILL.md')).toBe('skill foo v2 from B\n');
    });
  });

  describe('same files edited on both devices', () => {
    beforeAll(async () => {
      sandbox.write('A', 'CLAUDE.md', 'instructions v2 from A\n');
      sandbox.write('A', 'agents/a.md', 'agent a v2 from A\n');
      expect((await cli('A', 'push')).code).toBe(0);
      sandbox.write('B', 'CLAUDE.md', 'instructions v2 from B\n');
      sandbox.write('B', 'agents/a.md', 'agent a v2 from B\n');
    });

    it('pull exits 5 and leaves the local files untouched', async () => {
      expect((await cli('B', 'pull')).code).toBe(5);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions v2 from B\n');
      expect(sandbox.read('B', 'agents/a.md')).toBe('agent a v2 from B\n');
    });

    it('push is blocked with exit 5 and the remote head does not move', async () => {
      const head = sandbox.remoteHead();
      expect((await cli('B', 'push')).code).toBe(5);
      expect(sandbox.remoteHead()).toBe(head);
    });

    it('resolve settles each file and then push publishes the local choice', async () => {
      expect((await cli('B', 'resolve', 'CLAUDE.md', '--take-repo')).code).toBe(0);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('instructions v2 from A\n');

      expect((await cli('B', 'resolve', 'agents/a.md', '--take-local')).code).toBe(0);
      expect(sandbox.read('B', 'agents/a.md')).toBe('agent a v2 from B\n');

      expect((await cli('B', 'push')).code).toBe(0);
      expect((await cli('A', 'pull')).code).toBe(0);
      expect(sandbox.read('A', 'agents/a.md')).toBe('agent a v2 from B\n');
      expect(sandbox.read('A', 'CLAUDE.md')).toBe('instructions v2 from A\n');
    });
  });

  describe('secret scan', () => {
    it('push exits 4 and the remote stays untouched', async () => {
      sandbox.write('B', 'commands/leak.md', `${PRIVATE_KEY_HEADER}\nnot-a-real-key\n`);
      expect((await cli('B', 'add', 'command', 'leak.md')).code).toBe(0);
      const head = sandbox.remoteHead();

      const result = await cli('B', 'push');

      expect(result.code).toBe(4);
      expect(sandbox.remoteHead()).toBe(head);
      expect(result.stdout + result.stderr).not.toContain('not-a-real-key');
    });
  });

  describe('check, the hook that tells whether this device is in sync', () => {
    const hookInput = (event: string): string => JSON.stringify({ hook_event_name: event, session_id: 'e2e' });

    it('is silent and exits 0 when the device is in sync', async () => {
      const result = await sandbox.runBundle(bundle, 'A', ['check', '--hook'], { stdin: hookInput('SessionStart') });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('prints one hook JSON object for a local change and never pushes it', async () => {
      sandbox.write('A', 'skills/zed/SKILL.md', 'zed\n');
      expect((await cli('A', 'add', 'skill', 'zed')).code).toBe(0);
      const head = sandbox.remoteHead();

      const result = await sandbox.runBundle(bundle, 'A', ['check', '--hook'], {
        stdin: hookInput('UserPromptSubmit'),
        env: { AGENT_SYNC_AUTO_PUSH: '0' },
      });

      const output = JSON.parse(result.stdout) as { systemMessage: string; hookSpecificOutput: { hookEventName: string } };
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(output.systemMessage).toBe('sync-ai: 1 local change not pushed (run /sync-ai:sync)');
      expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      expect(sandbox.remoteHead()).toBe(head);
    });

    it('stays quiet with AGENT_SYNC_CHECK=0', async () => {
      const result = await sandbox.runBundle(bundle, 'A', ['check', '--hook'], {
        stdin: hookInput('SessionStart'),
        env: { AGENT_SYNC_CHECK: '0' },
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });
  });
});
