import type { AgentConfig } from '../agents/agent-config';
import type { Git } from '../infra/git';
import type { Io } from '../infra/io';

export interface CommandContext {
  readonly agent: AgentConfig;
  readonly dataHome: string;
  readonly repoDir: string;
  readonly assumeYes: boolean;
  readonly dryRun: boolean;
  readonly argument: string | undefined;
  readonly io: Io;
  /** Git without a repository bound (used for `clone`). */
  readonly git: Git;
  /** Git bound to the local clone of the user's repository. */
  readonly repoGit: Git;
  readonly hostname: string;
  readonly now: () => Date;
}
