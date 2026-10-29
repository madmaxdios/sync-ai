import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitBlobId } from '../src/domain/git-blob';
import { FakeEditor } from './helpers/fake-editor';
import { Sandbox, type Device } from './helpers/sandbox';
import { minimalPath } from './helpers/minimal-path';

const posixIt = process.platform === 'win32' ? it.skip : it;

const MULTI_LINE = 'one\ntwo\nthree\nfour\nfive\n';

describe('three-way conflict handling', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = new Sandbox({ autoList: true });
    sandbox.write('A', 'CLAUDE.md', 'shared v1\n');
    sandbox.write('A', 'commands/notes.md', MULTI_LINE);
    sandbox.write('A', 'agents/a.md', 'agent a\n');
    await sandbox.run('A', ['init', sandbox.remote]);
    await sandbox.run('A', ['push']);
    await sandbox.run('B', ['init', sandbox.remote]);
    await sandbox.run('B', ['pull']);
  });

  afterEach(() => sandbox.cleanup());

  const conflictsDir = (device: Device): string => path.join(sandbox.dataHome(device), 'conflicts', 'claude');
  const conflictCopy = (device: Device, rel: string, side: string): string =>
    path.join(conflictsDir(device), ...`${rel}.${side}`.split('/'));
  const baseOf = (device: Device, rel: string): string | undefined => {
    const state = JSON.parse(fs.readFileSync(path.join(sandbox.dataHome(device), 'state.json'), 'utf8')) as {
      agents: Record<string, { bases: Record<string, string> }>;
    };
    return state.agents.claude?.bases[rel];
  };

  /** A and B both edit CLAUDE.md; A publishes first, so B ends up with a conflict. */
  async function makeConflictOnB(): Promise<void> {
    sandbox.write('A', 'CLAUDE.md', 'from A\n');
    await sandbox.run('A', ['push']);
    sandbox.write('B', 'CLAUDE.md', 'from B\n');
  }

  describe('detection', () => {
    it('applies edits to different files on both devices with no prompt', async () => {
      sandbox.write('A', 'agents/a.md', 'agent a edited on A\n');
      await sandbox.run('A', ['push']);
      sandbox.write('B', 'CLAUDE.md', 'edited on B\n');

      const pulled = await sandbox.run('B', ['pull']);
      const pushed = await sandbox.run('B', ['push']);
      const pulledByA = await sandbox.run('A', ['pull']);

      expect(pulled.code).toBe(0);
      expect(pulled.questions).toEqual([]);
      expect(sandbox.read('B', 'agents/a.md')).toBe('agent a edited on A\n');
      expect(pushed.code).toBe(0);
      expect(pulledByA.code).toBe(0);
      expect(sandbox.read('A', 'CLAUDE.md')).toBe('edited on B\n');
    });

    it('records a conflict for a file edited on both devices and leaves the local file alone', async () => {
      await makeConflictOnB();

      const result = await sandbox.run('B', ['pull']);

      expect(result.code).toBe(5);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('from B\n');
      expect(fs.readFileSync(conflictCopy('B', 'CLAUDE.md', 'local'), 'utf8')).toBe('from B\n');
      expect(fs.readFileSync(conflictCopy('B', 'CLAUDE.md', 'repo'), 'utf8')).toBe('from A\n');
      expect(fs.readFileSync(conflictCopy('B', 'CLAUDE.md', 'base'), 'utf8')).toBe('shared v1\n');
      expect(fs.existsSync(path.join(conflictsDir('B'), 'manifest.json'))).toBe(true);
    });

    it('keeps conflict copies out of the agent home', async () => {
      await makeConflictOnB();

      await sandbox.run('B', ['pull']);

      const strays = fs.readdirSync(sandbox.agentHome('B')).filter((name) => /\.(local|repo|base)$/.test(name));
      expect(strays).toEqual([]);
    });

    it('blocks push with exit 5 until the conflict is resolved', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);
      const before = sandbox.remoteHead();

      const blocked = await sandbox.run('B', ['push']);

      expect(blocked.code).toBe(5);
      expect(blocked.stderr).toContain('CLAUDE.md');
      expect(sandbox.remoteHead()).toBe(before);
    });

    it('does not advance the base of an unresolved conflict', async () => {
      await makeConflictOnB();
      const originalBase = gitBlobId(Buffer.from('shared v1\n'));

      await sandbox.run('B', ['pull']);
      await sandbox.run('B', ['pull']);

      expect(baseOf('B', 'CLAUDE.md')).toBe(originalBase);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('from B\n');
    });

    it('treats a differing local file on a device without a base as a conflict', async () => {
      const fresh = new Sandbox({ autoList: true });
      try {
        fresh.write('A', 'CLAUDE.md', 'from A\n');
        await fresh.run('A', ['init', fresh.remote]);
        await fresh.run('A', ['push']);
        fresh.write('B', 'CLAUDE.md', 'older local copy\n');
        await fresh.run('B', ['init', fresh.remote]);

        const result = await fresh.run('B', ['pull']);

        expect(result.code).toBe(5);
        expect(fresh.read('B', 'CLAUDE.md')).toBe('older local copy\n');
      } finally {
        fresh.cleanup();
      }
    });

    it('does not write the conflicts area or the state on --dry-run', async () => {
      await makeConflictOnB();
      const stateBefore = fs.readFileSync(path.join(sandbox.dataHome('B'), 'state.json'), 'utf8');

      const result = await sandbox.run('B', ['pull', '--dry-run']);

      expect(result.code).toBe(5);
      expect(fs.existsSync(conflictsDir('B'))).toBe(false);
      expect(fs.readFileSync(path.join(sandbox.dataHome('B'), 'state.json'), 'utf8')).toBe(stateBefore);
    });

    it('never deletes repository files this device has not pulled yet when it pushes', async () => {
      sandbox.write('A', 'agents/extra.md', 'extra from A\n');
      await sandbox.run('A', ['push']);
      await sandbox.run('B', ['pull', '--dry-run']);
      sandbox.write('B', 'commands/only-b.md', 'b\n');

      const result = await sandbox.run('B', ['push']);

      expect(result.code).toBe(0);
      expect(sandbox.remoteFiles()).toContain('claude/agents/extra.md');
      expect(sandbox.remoteFiles()).toContain('claude/commands/only-b.md');
    });

    it('refuses to push over repository changes this device has not pulled into its files', async () => {
      sandbox.write('A', 'agents/a.md', 'newer agent a\n');
      await sandbox.run('A', ['push']);
      await sandbox.run('B', ['pull', '--dry-run']);
      sandbox.write('B', 'CLAUDE.md', 'edit on B\n');
      const before = sandbox.remoteHead();

      const result = await sandbox.run('B', ['push']);

      expect(result.code).toBe(1);
      expect(result.output).toContain("Run 'pull' before 'push'");
      expect(sandbox.remoteHead()).toBe(before);
    });
  });

  describe('deletions', () => {
    it('keeps a local file that was deleted in the repository and does not re-publish it', async () => {
      sandbox.remove('A', 'agents/a.md');
      await sandbox.run('A', ['push']);

      const pulled = await sandbox.run('B', ['pull']);
      sandbox.write('B', 'CLAUDE.md', 'edit on B\n');
      const pushed = await sandbox.run('B', ['push']);

      expect(pulled.code).toBe(0);
      expect(pulled.output).toContain('removed from the repository');
      expect(sandbox.exists('B', 'agents/a.md')).toBe(true);
      expect(pushed.code).toBe(0);
      expect(sandbox.remoteFiles()).not.toContain('claude/agents/a.md');
    });

    it('publishes a local deletion and does not bring the file back on pull', async () => {
      sandbox.remove('B', 'agents/a.md');

      const pulled = await sandbox.run('B', ['pull']);
      const pushed = await sandbox.run('B', ['push']);

      expect(pulled.code).toBe(0);
      expect(sandbox.exists('B', 'agents/a.md')).toBe(false);
      expect(pushed.code).toBe(0);
      expect(sandbox.remoteFiles()).not.toContain('claude/agents/a.md');
    });

    it('reports a conflict when a file was edited locally and deleted in the repository', async () => {
      sandbox.remove('A', 'agents/a.md');
      await sandbox.run('A', ['push']);
      sandbox.write('B', 'agents/a.md', 'edited on B\n');

      const result = await sandbox.run('B', ['pull']);

      expect(result.code).toBe(5);
      expect(sandbox.read('B', 'agents/a.md')).toBe('edited on B\n');
      expect(fs.existsSync(conflictCopy('B', 'agents/a.md', 'repo'))).toBe(false);
      expect(fs.existsSync(conflictCopy('B', 'agents/a.md', 'local'))).toBe(true);
    });

    it('removes the local file with a backup when --take-repo settles a delete-vs-edit conflict', async () => {
      sandbox.remove('A', 'agents/a.md');
      await sandbox.run('A', ['push']);
      sandbox.write('B', 'agents/a.md', 'edited on B\n');
      await sandbox.run('B', ['pull']);

      const result = await sandbox.run('B', ['resolve', 'agents/a.md', '--take-repo']);

      expect(result.code).toBe(0);
      expect(sandbox.exists('B', 'agents/a.md')).toBe(false);
      const [backup] = sandbox.backupsOf('B', 'agents/a.md');
      expect(fs.readFileSync(backup ?? '', 'utf8')).toBe('edited on B\n');
    });
  });

  describe('resolve', () => {
    it('lists the unresolved conflicts', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);

      const result = await sandbox.run('B', ['resolve']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Unresolved conflicts (1)');
      expect(result.stdout).toContain('! CLAUDE.md');
      expect(result.stdout).toContain(conflictsDir('B'));
    });

    it('says so when there is nothing to resolve', async () => {
      const result = await sandbox.run('B', ['resolve']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No unresolved conflicts');
    });

    it('rejects a path that is not a conflict and a missing strategy', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);

      const unknown = await sandbox.run('B', ['resolve', 'agents/a.md', '--take-local']);
      const missing = await sandbox.run('B', ['resolve', 'CLAUDE.md']);

      expect(unknown.code).toBe(1);
      expect(unknown.stderr).toContain('not an unresolved conflict');
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('--take-local');
    });

    it('rejects two strategies at once', async () => {
      const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--take-local', '--take-repo']);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('choose only one');
    });

    it('--take-local keeps the local file, unblocks push and publishes it', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);

      const resolved = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--take-local']);
      const pushed = await sandbox.run('B', ['push']);
      const pulledByA = await sandbox.run('A', ['pull']);

      expect(resolved.code).toBe(0);
      expect(fs.existsSync(conflictCopy('B', 'CLAUDE.md', 'repo'))).toBe(false);
      expect(pushed.code).toBe(0);
      expect(pulledByA.code).toBe(0);
      expect(sandbox.read('A', 'CLAUDE.md')).toBe('from B\n');
    });

    it('--take-repo replaces the local file, keeps a backup and has nothing left to push', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);

      const resolved = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--take-repo']);
      const pushed = await sandbox.run('B', ['push']);

      expect(resolved.code).toBe(0);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('from A\n');
      const [backup] = sandbox.backupsOf('B', 'CLAUDE.md');
      expect(fs.readFileSync(backup ?? '', 'utf8')).toBe('from B\n');
      expect(pushed.output).toContain('No changes to publish');
    });

    it('--dry-run changes nothing', async () => {
      await makeConflictOnB();
      await sandbox.run('B', ['pull']);

      const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--take-repo', '--dry-run']);

      expect(result.code).toBe(0);
      expect(sandbox.read('B', 'CLAUDE.md')).toBe('from B\n');
      expect(fs.existsSync(conflictCopy('B', 'CLAUDE.md', 'repo'))).toBe(true);
    });

    describe('--auto', () => {
      it('merges edits that do not overlap and lets the result be pushed', async () => {
        sandbox.write('A', 'commands/notes.md', 'ONE\ntwo\nthree\nfour\nfive\n');
        await sandbox.run('A', ['push']);
        sandbox.write('B', 'commands/notes.md', 'one\ntwo\nthree\nfour\nFIVE\n');
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'commands/notes.md', '--auto']);
        const pushed = await sandbox.run('B', ['push']);

        expect(result.code).toBe(0);
        expect(sandbox.read('B', 'commands/notes.md')).toBe('ONE\ntwo\nthree\nfour\nFIVE\n');
        expect(sandbox.backupsOf('B', 'commands/notes.md')).toHaveLength(1);
        expect(pushed.code).toBe(0);
      });

      it('changes nothing and keeps the conflict open when the edits overlap', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--auto']);

        expect(result.code).toBe(5);
        expect(result.stderr).toContain('still conflicts');
        expect(sandbox.read('B', 'CLAUDE.md')).toBe('from B\n');
        expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
        expect((await sandbox.run('B', ['resolve'])).stdout).toContain('! CLAUDE.md');
      });
    });

    describe('--editor', () => {
      let editor: FakeEditor;

      beforeEach(() => {
        editor = new FakeEditor();
      });

      afterEach(() => editor.cleanup());

      posixIt('opens VS Code three-way with copies and the real file, and asks before resolving', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor'], {
          confirm: true,
          env: editor.env({ result: 'merged by hand\n' }),
        });

        expect(result.code).toBe(0);
        expect(result.questions).toHaveLength(1);
        expect(editor.calls()).toEqual([
          [
            '--wait',
            '--merge',
            conflictCopy('B', 'CLAUDE.md', 'local'),
            conflictCopy('B', 'CLAUDE.md', 'repo'),
            conflictCopy('B', 'CLAUDE.md', 'base'),
            path.join(sandbox.agentHome('B'), 'CLAUDE.md'),
          ],
        ]);
        expect(sandbox.read('B', 'CLAUDE.md')).toBe('merged by hand\n');
        expect(fs.existsSync(conflictCopy('B', 'CLAUDE.md', 'repo'))).toBe(false);
        expect((await sandbox.run('B', ['push'])).code).toBe(0);
      });

      posixIt('does not mark the conflict resolved without a confirmation (exit 3)', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor=code'], {
          env: editor.env({ result: 'merged by hand\n' }),
        });

        expect(result.code).toBe(3);
        expect(result.stderr).toContain('resolve CLAUDE.md --take-local');
        expect(sandbox.read('B', 'CLAUDE.md')).toBe('merged by hand\n');
        expect(sandbox.backupsOf('B', 'CLAUDE.md')).toHaveLength(1);
        expect((await sandbox.run('B', ['resolve'])).stdout).toContain('! CLAUDE.md');
      });

      posixIt('resolves right after the editor with --yes', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor', '--yes'], {
          env: editor.env({ result: 'merged by hand\n' }),
        });

        expect(result.code).toBe(0);
        expect((await sandbox.run('B', ['resolve'])).stdout).toContain('No unresolved conflicts');
      });

      posixIt('keeps the conflict open when the editor fails', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor', '--yes'], {
          env: editor.env({ exitCode: 2 }),
        });

        expect(result.code).toBe(1);
        expect((await sandbox.run('B', ['resolve'])).stdout).toContain('! CLAUDE.md');
      });

      posixIt('prints the manual commands and changes nothing when no editor is available', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor'], {
          env: { PATH: minimalPath(sandbox.root, ['git']) },
        });

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('code --wait --merge');
        expect(sandbox.read('B', 'CLAUDE.md')).toBe('from B\n');
        expect(sandbox.backupsOf('B', 'CLAUDE.md')).toEqual([]);
      });

      posixIt('refuses --editor=vimdiff without a terminal', async () => {
        await makeConflictOnB();
        await sandbox.run('B', ['pull']);

        const result = await sandbox.run('B', ['resolve', 'CLAUDE.md', '--editor=vimdiff']);

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('needs a terminal');
      });
    });
  });
});
