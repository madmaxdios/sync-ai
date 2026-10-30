import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAgent } from '../src/agents/registry';

describe('codex agent', () => {
  it('uses ~/.codex and only allows AGENTS.md and skills', () => {
    const config = resolveAgent('codex', { env: {}, homeDir: '/home/test' });
    expect(config.name).toBe('codex');
    expect(config.home).toBe(path.join('/home/test', '.codex'));
    expect(config.allow).toEqual(['AGENTS.md', 'skills', '.sync-ai-plugins.json']);
    expect(config.optIn).toEqual(['skills']);
    expect(config.deny).toEqual(expect.arrayContaining(['auth.json', 'config.toml', 'sessions', 'databases']));
  });

  it('honors CODEX_CONFIG_DIR', () => {
    expect(resolveAgent('codex', { env: { CODEX_CONFIG_DIR: '/custom/codex' }, homeDir: '/home/test' }).home).toBe(
      '/custom/codex',
    );
  });
});

describe('opencode agent', () => {
  it('uses ~/.config/opencode and allows personal skills and commands', () => {
    const config = resolveAgent('opencode', { env: {}, homeDir: '/home/test' });
    expect(config.name).toBe('opencode');
    expect(config.home).toBe(path.join('/home/test', '.config', 'opencode'));
    expect(config.allow).toContain('skills');
    expect(config.allow).toContain('commands');
    expect(config.optIn).toEqual(['skills', 'commands', 'agents', 'instructions']);
    expect(config.deny).toEqual(expect.arrayContaining(['auth.json', 'node_modules', 'opencode.json']));
  });

  it('honors OPENCODE_CONFIG_DIR', () => {
    expect(resolveAgent('opencode', { env: { OPENCODE_CONFIG_DIR: '/custom/opencode' }, homeDir: '/home/test' }).home).toBe(
      '/custom/opencode',
    );
  });
});
