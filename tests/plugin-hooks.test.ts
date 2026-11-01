import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Sandbox } from './helpers/sandbox';

const hookConfigSchema = z.object({
  hooks: z.record(z.string(), z.array(z.object({
    hooks: z.array(z.object({ command: z.string(), statusMessage: z.string() })),
  }))),
});

const root = path.resolve(import.meta.dirname, '..');

describe('installed plugin hook commands', () => {
  let sandbox: Sandbox | undefined;
  afterEach(() => sandbox?.cleanup());

  it.each(['claude', 'codex'] as const)('synchronizes only %s and reports the result', async (agent) => {
    sandbox = new Sandbox();
    const main = agent === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
    sandbox.writeAgent('A', agent, main, 'initial instructions\n');
    expect((await sandbox.run('A', ['init', sandbox.remote], { agent })).code).toBe(0);
    expect((await sandbox.run('A', ['push'], { agent })).code).toBe(0);
    expect((await sandbox.run('B', ['init', sandbox.remote], { agent })).code).toBe(0);
    expect((await sandbox.run('B', ['pull'], { agent })).code).toBe(0);
    sandbox.writeAgent('B', agent, main, 'updated instructions\n');
    expect((await sandbox.run('B', ['push'], { agent })).code).toBe(0);

    const manifest = z.object({ hooks: z.string().optional() }).parse(JSON.parse(fs.readFileSync(path.join(root, `.${agent}-plugin/plugin.json`), 'utf8')));
    const config = hookConfigSchema.parse(JSON.parse(fs.readFileSync(path.join(root, manifest.hooks ?? 'hooks/hooks.json'), 'utf8')));
    const command = config.hooks.SessionStart?.[0]?.hooks[0];
    if (!command) throw new Error(`Missing ${agent} SessionStart hook`);
    expect(command.statusMessage).toContain('sync');
    const result = spawnSync(command.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', root), {
      shell: true,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'plugin-test' }),
      env: {
        ...process.env,
        HOME: sandbox.home('A'), USERPROFILE: sandbox.home('A'),
        CLAUDE_CONFIG_DIR: sandbox.configHome('A', 'claude'),
        CODEX_CONFIG_DIR: sandbox.configHome('A', 'codex'),
        AGENT_SYNC_HOME: sandbox.dataHome('A'),
        GIT_CONFIG_GLOBAL: sandbox.globalGitConfig, GIT_CONFIG_NOSYSTEM: '1',
        AGENT_SYNC_AUTO_PUSH: '0',
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const output = z.object({ systemMessage: z.string() }).parse(JSON.parse(result.stdout));
    expect(output.systemMessage).toContain('pulled 1 file');
    expect(sandbox.readAgent('A', agent, main)).toBe('updated instructions\n');
    const other = agent === 'codex' ? 'claude' : 'codex';
    expect(sandbox.readAgent('A', other, other === 'claude' ? 'CLAUDE.md' : 'AGENTS.md')).toBeUndefined();
  });
});
