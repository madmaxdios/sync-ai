import path from 'node:path';
import type { AgentConfigInput, AgentEnvironment } from './agent-config';

export function buildCodexConfig({ env, homeDir }: AgentEnvironment): AgentConfigInput {
  return {
    name: 'codex',
    home: env.CODEX_CONFIG_DIR || path.join(homeDir, '.codex'),
    allow: ['AGENTS.md', 'skills', '.sync-ai-plugins.json'],
    optIn: ['skills'],
    deny: [
      'auth.json',
      'config.toml',
      'config.local.toml',
      'sessions',
      'history.jsonl',
      'state.sqlite',
      'databases',
      'logs',
      'cache',
      'plugins',
      '*.backup-*',
      '*.bak',
      '*.bak-*',
      '*.tmp',
      '.git',
      '.DS_Store',
    ],
  };
}
