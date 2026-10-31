import { z } from 'zod';

export const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * name:  agent identifier, also the folder inside the user's data repository.
 * home:  directory where the agent keeps its user-level configuration.
 * allow: paths (relative to home) that may be synced. Anything else is never
 *        read, copied or committed.
 * deny:  globs matched against EVERY path component of an allowed file. Keep
 *        names specific: a skill folder named like a denied entry is skipped.
 * optIn: folders (relative to home) whose direct children are synced only when listed:
 *        `skills/git` or `commands/deploy.md`. Allowed paths outside these folders
 *        (such as CLAUDE.md) are always synced.
 * mainFile: the agent's main instruction file, stored as skills/MAIN-SKILL.md in the data repo.
 * shared: local folders stored at the root of the data repo and shared by all agents.
 */
export const agentConfigSchema = z.object({
  name: z.string().regex(AGENT_NAME_PATTERN),
  home: z.string().min(1),
  allow: z.array(z.string().min(1)).min(1),
  deny: z.array(z.string().min(1)),
  optIn: z.array(z.string().min(1)).default([]),
  mainFile: z.string().min(1),
  shared: z.array(z.string().min(1)).default(['skills']),
});

export type AgentConfig = z.output<typeof agentConfigSchema>;
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export type Env = Readonly<Record<string, string | undefined>>;

export interface AgentEnvironment {
  readonly env: Env;
  readonly homeDir: string;
}
