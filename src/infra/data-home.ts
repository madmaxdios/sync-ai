import path from 'node:path';
import type { Env } from '../agents/agent-config';

/** Directory that holds the local clone of the user's private repository. */
export function resolveDataHome(env: Env, homeDir: string, platform: NodeJS.Platform): string {
  if (env.AGENT_SYNC_HOME) return env.AGENT_SYNC_HOME;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, 'agent-sync');
  }
  return path.join(homeDir, '.local', 'share', 'agent-sync');
}
