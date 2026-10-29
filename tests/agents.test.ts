import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAgent } from '../src/agents/registry';

describe('codex agent', () => {
  it('uses ~/.codex and only allows AGENTS.md and skills', () => {
    const config = resolveAgent('codex', { env: {}, homeDir: '/home/test' });
    expect(config.name).toBe('codex');
    expect(config.home).toBe(path.join('/home/test', '.codex'));
    expect(config.allow).toEqual(['AGENTS.md', 'skills']);
    expect(config.optIn).toEqual(['skills']);
    expect(config.deny).toEqual(expect.arrayContaining(['auth.json', 'config.toml', 'sessions', 'databases']));
  });

  it('honors CODEX_CONFIG_DIR', () => {
    expect(resolveAgent('codex', { env: { CODEX_CONFIG_DIR: '/custom/codex' }, homeDir: '/home/test' }).home).toBe(
      '/custom/codex',
    );
  });
});
