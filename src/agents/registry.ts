import { AppError } from '../domain/app-error';
import {
  AGENT_NAME_PATTERN,
  agentConfigSchema,
  type AgentConfig,
  type AgentConfigInput,
  type AgentEnvironment,
} from './agent-config';
import { buildClaudeConfig } from './claude';

// A Map avoids resolving inherited keys such as "constructor" as agents.
const AGENT_BUILDERS = new Map<string, (environment: AgentEnvironment) => AgentConfigInput>([
  ['claude', buildClaudeConfig],
]);

export function resolveAgent(name: string, environment: AgentEnvironment): AgentConfig {
  if (!AGENT_NAME_PATTERN.test(name)) throw new AppError(`invalid agent name: ${name}`);

  const build = AGENT_BUILDERS.get(name);
  if (!build) throw new AppError(`unsupported agent: ${name}`);

  const parsed = agentConfigSchema.safeParse(build(environment));
  if (!parsed.success) throw new AppError(`incomplete configuration for agent: ${name}`);
  return parsed.data;
}
