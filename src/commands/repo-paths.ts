import type { AgentConfig } from '../agents/agent-config';

const SHARED_SKILL_MAIN = 'skills/MAIN-SKILL.md';

function startsIn(rel: string, folder: string): boolean {
  return rel === folder || rel.startsWith(`${folder}/`);
}

/** Maps a local agent path to the canonical path in sync-ai-data. */
export function repoPathForLocal(agent: AgentConfig, localRel: string): string {
  if (localRel === agent.mainFile) return SHARED_SKILL_MAIN;
  if (agent.shared.some((folder) => startsIn(localRel, folder))) return localRel;
  return `${agent.name}/${localRel}`;
}

/** Maps a canonical sync-ai-data path to the local path for one agent. */
export function localPathForRepo(agent: AgentConfig, repoRel: string): string | undefined {
  if (repoRel === SHARED_SKILL_MAIN) return agent.mainFile;
  if (agent.shared.some((folder) => startsIn(repoRel, folder))) return repoRel;
  const prefix = `${agent.name}/`;
  return repoRel.startsWith(prefix) ? repoRel.slice(prefix.length) : undefined;
}
