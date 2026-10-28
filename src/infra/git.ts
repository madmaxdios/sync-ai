import type { Env } from '../agents/agent-config';
import { AppError } from '../domain/app-error';
import { runProcess, runProcessBinary, type ProcessResult } from './run-process';

export type GitResult = ProcessResult;

export class Git {
  constructor(
    private readonly env: Env,
    private readonly prefix: readonly string[] = [],
  ) {}

  /** Returns a Git bound to a repository directory (`git -C <dir> ...`). */
  withRepo(repoDir: string): Git {
    return new Git(this.env, ['-C', repoDir]);
  }

  /** Runs git without a shell. Resolves on non-zero exit codes too. */
  async run(args: readonly string[]): Promise<GitResult> {
    // Never block on a credentials prompt: this runs inside a non-interactive slash command.
    const env = { ...this.env, GIT_TERMINAL_PROMPT: '0' };
    const result = await runProcess('git', [...this.prefix, ...args], env);
    if (!result) throw new AppError('git is not installed or not found in PATH');
    return result;
  }

  /** Runs git and returns stdout, or throws an AppError with git's message. */
  async must(args: readonly string[]): Promise<string> {
    const result = await this.run(args);
    if (result.code === 0) return result.stdout;
    const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new AppError(`git ${args[0] ?? ''} failed: ${reason}`);
  }

  /** Returns the raw content of a blob (`git cat-file blob`), or undefined when it is missing. */
  async blob(id: string): Promise<Buffer | undefined> {
    const env = { ...this.env, GIT_TERMINAL_PROMPT: '0' };
    const result = await runProcessBinary('git', [...this.prefix, 'cat-file', 'blob', id], env);
    if (!result) throw new AppError('git is not installed or not found in PATH');
    return result.code === 0 ? result.stdout : undefined;
  }

  async succeeds(args: readonly string[]): Promise<boolean> {
    return (await this.run(args)).code === 0;
  }
}
