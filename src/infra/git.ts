import { execFile, type ExecFileException } from 'node:child_process';
import type { Env } from '../agents/agent-config';
import { AppError } from '../domain/app-error';

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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
  run(args: readonly string[]): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        [...this.prefix, ...args],
        {
          // Never block on a credentials prompt: this runs inside a non-interactive slash command.
          env: { ...this.env, GIT_TERMINAL_PROMPT: '0' },
          encoding: 'utf8',
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error: ExecFileException | null, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout, stderr });
            return;
          }
          if (error.code === 'ENOENT') {
            reject(new AppError('git is not installed or not found in PATH'));
            return;
          }
          const code = typeof error.code === 'number' ? error.code : 1;
          resolve({ code, stdout, stderr: stderr || error.message });
        },
      );
    });
  }

  /** Runs git and returns stdout, or throws an AppError with git's message. */
  async must(args: readonly string[]): Promise<string> {
    const result = await this.run(args);
    if (result.code === 0) return result.stdout;
    const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new AppError(`git ${args[0] ?? ''} failed: ${reason}`);
  }

  async succeeds(args: readonly string[]): Promise<boolean> {
    return (await this.run(args)).code === 0;
  }
}
