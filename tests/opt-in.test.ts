import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

describe('opt-in list', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = new Sandbox();
    sandbox.write('A', 'CLAUDE.md', 'instructions\n');
    sandbox.write('A', 'skills/git/SKILL.md', 'git skill\n');
    sandbox.write('A', 'commands/deploy.md', 'deploy\n');
    await sandbox.run('A', ['init', sandbox.remote]);
    await sandbox.run('B', ['init', sandbox.remote]);
  });
  afterEach(() => sandbox.cleanup());

  it('publishes only CLAUDE.md until something is added', async () => {
    const result = await sandbox.run('A', ['push']);

    expect(result.code).toBe(0);
    expect(sandbox.remoteFiles()).toEqual(['claude/CLAUDE.md']);
    expect(result.stdout).toContain('2 items not synced');
  });

  it('publishes an item once it is added, and nothing else', async () => {
    await sandbox.run('A', ['push']);

    const add = await sandbox.run('A', ['add', 'skill', 'git']);
    await sandbox.run('A', ['push']);

    expect(add.code).toBe(0);
    expect(sandbox.remoteFiles().sort()).toEqual(['claude/CLAUDE.md', 'claude/skills/git/SKILL.md']);
  });

  it('adds a command by name with or without .md and an agent too', async () => {
    sandbox.write('A', 'agents/rev.md', 'reviewer\n');

    expect((await sandbox.run('A', ['add', 'command', 'deploy'])).code).toBe(0);
    expect((await sandbox.run('A', ['add', 'agent', 'rev.md'])).code).toBe(0);
    await sandbox.run('A', ['push']);

    expect(sandbox.remoteFiles()).toEqual(
      expect.arrayContaining(['claude/commands/deploy.md', 'claude/agents/rev.md']),
    );
  });

  it('fails with a clear message for a missing item and exits 2 for bad usage', async () => {
    const missing = await sandbox.run('A', ['add', 'skill', 'nope']);
    const usage = await sandbox.run('A', ['add', 'widget', 'x']);

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("no skill named 'nope'");
    expect(usage.code).toBe(2);
  });

  it('add --dry-run changes nothing', async () => {
    await sandbox.run('A', ['add', 'skill', 'git', '--dry-run']);
    await sandbox.run('A', ['push']);

    expect(sandbox.remoteFiles()).toEqual(['claude/CLAUDE.md']);
  });

  it('items that come from the repository are listed automatically after a pull', async () => {
    await sandbox.run('A', ['add', 'skill', 'git']);
    await sandbox.run('A', ['push']);
    await sandbox.run('B', ['pull']);
    sandbox.write('B', 'skills/git/SKILL.md', 'edited on B\n');

    const status = await sandbox.run('B', ['status']);

    expect(status.stdout).toContain('To push');
    expect(status.stdout).toContain('skills/git/SKILL.md');
    expect(status.stdout).not.toContain('not synced');
  });

  it('migrates a state that predates the list: what the repository has stays synced', async () => {
    await sandbox.run('A', ['add', 'skill', 'git']);
    await sandbox.run('A', ['push']);
    await sandbox.run('B', ['pull']);
    sandbox.write('B', 'skills/git/SKILL.md', 'edited on B\n');

    // The legacy state has bases only, no list.
    const state = JSON.parse(sandbox.dataFile('B', 'state.json') ?? '{}') as {
      agents: Record<string, { bases: unknown; synced?: unknown }>;
    };
    for (const agent of Object.values(state.agents)) delete agent.synced;
    sandbox.writeDataFile('B', 'state.json', JSON.stringify(state));

    const push = await sandbox.run('B', ['push']);

    expect(push.code).toBe(0);
    expect(sandbox.remoteContains('edited on B')).toBe(true);
  });

  describe('status', () => {
    it('summarises unlisted items on one line and --all lists them', async () => {
      await sandbox.run('A', ['push']);

      const short = await sandbox.run('A', ['status']);
      const all = await sandbox.run('A', ['status', '--all']);

      expect(short.stdout).toContain('2 items not synced; run status --all to list them');
      expect(short.stdout).not.toContain('skills/git');
      expect(all.stdout).toContain('skills/git');
      expect(all.stdout).toContain('commands/deploy.md');
    });

    it('says nothing when every local item is listed', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['add', 'command', 'deploy']);
      await sandbox.run('A', ['push']);

      const status = await sandbox.run('A', ['status']);

      expect(status.stdout).not.toContain('not synced');
      expect(status.stdout).toContain('✓ Todo sincronizado');
      expect(status.stdout).toContain('Local configuration:');
      expect(status.stdout).not.toContain('Repository:');
      expect(status.stdout).toContain('|--- skills/');
      expect(status.stdout).toContain('|    |--- git/');
    });

    it('does not use the local clone as a sync source when the remote is unreachable', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['push']);
      sandbox.disconnectRemote();

      try {
        const status = await sandbox.run('A', ['status']);

        expect(status.output).toContain('Comparison skipped:');
        expect(status.output).not.toContain('Todo sincronizado');
        expect(status.output).not.toContain('no differences');
      } finally {
        sandbox.reconnectRemote();
      }
    });
  });

  describe('name collisions', () => {
    it('never overwrites a local item with the same name as a repository one: it is a conflict', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['push']);
      sandbox.write('B', 'skills/git/SKILL.md', 'a different git skill\n');

      const pull = await sandbox.run('B', ['pull']);

      expect(pull.code).toBe(5);
      expect(sandbox.read('B', 'skills/git/SKILL.md')).toBe('a different git skill\n');
      expect(sandbox.backupsOf('B', 'skills/git/SKILL.md')).toEqual([]);
    });

    it('can be resolved like any other conflict', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['push']);
      sandbox.write('B', 'skills/git/SKILL.md', 'a different git skill\n');
      await sandbox.run('B', ['pull']);

      const resolve = await sandbox.run('B', ['resolve', 'skills/git/SKILL.md', '--take-repo']);

      expect(resolve.code).toBe(0);
      expect(sandbox.read('B', 'skills/git/SKILL.md')).toBe('git skill\n');
    });
  });

  describe('remove', () => {
    it('stops syncing without deleting files locally or in the repository', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['push']);
      const head = sandbox.remoteHead();

      const remove = await sandbox.run('A', ['remove', 'skill', 'git']);
      sandbox.write('A', 'skills/git/SKILL.md', 'edited after removal\n');
      const push = await sandbox.run('A', ['push']);

      expect(remove.code).toBe(0);
      expect(sandbox.read('A', 'skills/git/SKILL.md')).toBe('edited after removal\n');
      expect(sandbox.remoteFiles()).toContain('claude/skills/git/SKILL.md');
      expect(sandbox.remoteContains('edited after removal')).toBe(false);
      expect(push.code).toBe(0);
      expect(sandbox.remoteHead()).toBe(head);
    });

    it('a removed item can be added again', async () => {
      await sandbox.run('A', ['add', 'skill', 'git']);
      await sandbox.run('A', ['push']);
      await sandbox.run('A', ['remove', 'skill', 'git']);
      await sandbox.run('A', ['add', 'skill', 'git']);
      sandbox.write('A', 'skills/git/SKILL.md', 'edited again\n');

      await sandbox.run('A', ['push']);

      expect(sandbox.remoteContains('edited again')).toBe(true);
    });
  });
});
