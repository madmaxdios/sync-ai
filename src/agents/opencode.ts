import path from 'node:path';
import type { AgentConfigInput, AgentEnvironment } from './agent-config';

export function buildOpenCodeConfig({ env, homeDir }: AgentEnvironment): AgentConfigInput {
  return {
    name: 'opencode',
    home: env.OPENCODE_CONFIG_DIR || path.join(homeDir, '.config', 'opencode'),
    allow: ['AGENTS.md', 'skills', 'commands', 'agents', 'instructions', '.sync-ai-plugins.json'],
    mainFile: 'AGENTS.md',
    shared: ['skills'],
    optIn: ['skills', 'commands', 'agents', 'instructions'],
    deny: [
      'auth.json',
      'node_modules',
      'plugins',
      'package-lock.json',
      'opencode.json',
      'opencode.jsonc',
      '*.db',
      '*.db-shm',
      '*.db-wal',
      '*.backup-*',
      '*.bak',
      '*.bak-*',
      '*.tmp',
      '.git',
      '.DS_Store',
    ],
  };
}
