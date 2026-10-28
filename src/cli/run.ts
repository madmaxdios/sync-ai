import os from 'node:os';
import path from 'node:path';
import { resolveAgent } from '../agents/registry';
import type { Env } from '../agents/agent-config';
import { runInit } from '../commands/init';
import { runPull } from '../commands/pull';
import { runPush } from '../commands/push';
import { runResolve } from '../commands/resolve';
import { runStatus } from '../commands/status';
import type { CommandContext } from '../commands/context';
import { AppError, UsageError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { resolveDataHome } from '../infra/data-home';
import { GitHubCli } from '../infra/gh';
import { Git } from '../infra/git';
import type { Io } from '../infra/io';
import { commandNameSchema, type CommandName } from './command-name';
import { parseArgs } from './parse-args';
import { USAGE } from './usage';

export interface Runtime {
  readonly env: Env;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly hostname: string;
  readonly io: Io;
  readonly now: () => Date;
  /** Whether stdin is an interactive terminal (defaults to false). */
  readonly hasTerminal?: boolean;
}

export function defaultRuntime(io: Io): Runtime {
  return {
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
    hostname: os.hostname(),
    io,
    now: () => new Date(),
    hasTerminal: Boolean(process.stdin.isTTY),
  };
}

const COMMANDS: Record<CommandName, (context: CommandContext) => Promise<ExitCode>> = {
  init: runInit,
  pull: runPull,
  push: runPush,
  status: runStatus,
  resolve: runResolve,
};

async function execute(argv: readonly string[], runtime: Runtime): Promise<ExitCode> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    runtime.io.info(USAGE);
    return ExitCode.Ok;
  }

  const { options } = parsed;
  if (!options.command) throw new UsageError('missing command');

  const agent = resolveAgent(options.agent, { env: runtime.env, homeDir: runtime.homeDir });
  const command = commandNameSchema.safeParse(options.command);
  if (!command.success) throw new UsageError(`unknown command: ${options.command}`);

  const dataHome = resolveDataHome(runtime.env, runtime.homeDir, runtime.platform);
  const repoDir = path.join(dataHome, 'repo');
  const git = new Git(runtime.env);

  return COMMANDS[command.data]({
    agent,
    dataHome,
    repoDir,
    assumeYes: options.assumeYes,
    dryRun: options.dryRun,
    argument: options.argument,
    repoName: options.name,
    resolution: options.resolution,
    editor: options.editor,
    io: runtime.io,
    git,
    repoGit: git.withRepo(repoDir),
    gh: new GitHubCli(runtime.env),
    hostname: runtime.hostname,
    env: runtime.env,
    platform: runtime.platform,
    hasTerminal: runtime.hasTerminal ?? false,
    now: runtime.now,
  });
}

/** Runs the CLI and returns its exit code; it never throws for expected failures. */
export async function runCli(argv: readonly string[], runtime: Runtime): Promise<ExitCode> {
  try {
    return await execute(argv, runtime);
  } catch (error) {
    if (error instanceof UsageError) {
      runtime.io.warn(`Error: ${error.message}`);
      runtime.io.warn(USAGE);
      return error.exitCode;
    }
    if (error instanceof AppError) {
      runtime.io.warn(`Error: ${error.message}`);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    runtime.io.warn(`Error: ${message}`);
    return ExitCode.Error;
  }
}
