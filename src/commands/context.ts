import type { AgentConfig, Env } from '../agents/agent-config';
import type { EditorChoice, Resolution } from '../cli/resolution';
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
  /** How `resolve` should settle a conflict (only meaningful for `resolve <path>`). */
  readonly resolution: Resolution | undefined;
  /** Editor used by `resolve --editor`. */
  readonly editor: EditorChoice | undefined;
  readonly io: Io;
  /** Git without a repository bound (used for `clone`). */
  readonly git: Git;
  /** Git bound to the local clone of the user's repository. */
  readonly repoGit: Git;
  /** GitHub CLI, used by `init` to create the repository. */
  readonly gh: GitHubCli;
  readonly hostname: string;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** True when the CLI runs attached to an interactive terminal. */
  readonly hasTerminal: boolean;
  readonly now: () => Date;
}
