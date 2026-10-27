import path from 'node:path';
import type { AgentConfigInput, AgentEnvironment } from './agent-config';

export function buildClaudeConfig({ env, homeDir }: AgentEnvironment): AgentConfigInput {
  return {
    name: 'claude',
    home: env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'),
    allow: ['CLAUDE.md', 'skills', 'commands', 'agents'],
    deny: [
      // Credentials and settings that may embed tokens or machine-specific paths
      '.credentials.json',
      'settings.json',
      'settings.local.json',
      'mcp-needs-auth-cache.json',
      // History, sessions and installed plugins
      'history.jsonl',
      'projects',
      'sessions',
      'plugins',
      'backups',
      // Skills that claude.ai already syncs per account (not user-authored)
      'synced',
      // Local copies and noise
      '*.backup-*',
      '*.bak',
      '*.bak-*',
      '*.tmp',
      '.git',
      '.DS_Store',
    ],
  };
}
