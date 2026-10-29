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
  /** Second positional argument (`add <kind> <name>`, `remove <kind> <name>`). */
  readonly argument2: string | undefined;
  /** Repository name given with --name (only meaningful for `init` without a URL). */
  readonly repoName: string | undefined;
  /** How `resolve` should settle a conflict (only meaningful for `resolve <path>`). */
  readonly resolution: Resolution | undefined;
  /** Editor used by `resolve --editor`. */
  readonly editor: EditorChoice | undefined;
  /** `status` only: also list the items that are not synced. */
  readonly all: boolean;
  /** The OS user name of this device, which the scanner keeps out of published files. */
  readonly username: string | undefined;
  /** `check` only: read the agent's hook JSON from stdin and answer with hook JSON. */
  readonly hook: boolean;
  /** `check` only: print nothing when everything is in sync. */
  readonly quiet: boolean;
  /** Reads what the agent writes to a hook's stdin (empty when there is nothing). */
  readonly readStdin: () => Promise<string>;
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
