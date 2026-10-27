import type { AgentConfig } from '../agents/agent-config';
import type { GitHubCli } from '../infra/gh';
import type { Git } from '../infra/git';
import type { Io } from '../infra/io';

export interface CommandContext {
  readonly agent: AgentConfig;
  readonly dataHome: string;
  readonly repoDir: string;
  readonly assumeYes: boolean;
  readonly dryRun: boolean;
  readonly argument: string | undefined;
  /** Repository name given with --name (only meaningful for `init` without a URL). */
  readonly repoName: string | undefined;
  readonly io: Io;
  /** Git without a repository bound (used for `clone`). */
  readonly git: Git;
  /** Git bound to the local clone of the user's repository. */
  readonly repoGit: Git;
  /** GitHub CLI, used by `init` to create the repository. */
  readonly gh: GitHubCli;
  readonly hostname: string;
  readonly now: () => Date;
}
