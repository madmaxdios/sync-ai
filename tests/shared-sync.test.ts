import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

describe('shared skills across agents', () => {
  const sandbox = new Sandbox();

  beforeAll(async () => {
    sandbox.writeAgent('A', 'claude', 'CLAUDE.md', 'shared instructions\n');
    sandbox.writeAgent('A', 'claude', 'skills/common/SKILL.md', 'common skill\n');
    await sandbox.run('A', ['init', sandbox.remote]);
    expect((await sandbox.run('A', ['add', 'skill', 'common'])).code).toBe(0);
    expect((await sandbox.run('A', ['push'])).code).toBe(0);
  });

  afterAll(() => sandbox.cleanup());

  it('stores the main instruction and skill at shared repository paths', () => {
    expect(sandbox.remoteFiles()).toEqual(['skills/MAIN-SKILL.md', 'skills/common/SKILL.md']);
  });

  it('installs shared content into Codex using its local names', async () => {
    await sandbox.run('B', ['init', sandbox.remote], { agent: 'codex' });
    expect((await sandbox.run('B', ['pull'], { agent: 'codex' })).code).toBe(0);
    expect(sandbox.readAgent('B', 'codex', 'AGENTS.md')).toBe('shared instructions\n');
    expect(sandbox.readAgent('B', 'codex', 'skills/common/SKILL.md')).toBe('common skill\n');
  });

  it('lets OpenCode consume the same shared content', async () => {
    await sandbox.run('C', ['init', sandbox.remote], { agent: 'opencode' });
    expect((await sandbox.run('C', ['pull'], { agent: 'opencode' })).code).toBe(0);
    expect(sandbox.readAgent('C', 'opencode', 'AGENTS.md')).toBe('shared instructions\n');
    expect(sandbox.readAgent('C', 'opencode', 'skills/common/SKILL.md')).toBe('common skill\n');
  });
});
