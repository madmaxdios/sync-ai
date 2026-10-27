import type { Env } from '../agents/agent-config';
import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { runProcess, type ProcessResult } from './run-process';

export type GhResult = ProcessResult;

export class GitHubCli {
  constructor(private readonly env: Env) {}

  /** Runs gh without a shell and without interactive prompts. */
  async run(args: readonly string[]): Promise<GhResult> {
    const result = await runProcess('gh', args, { ...this.env, GH_PROMPT_DISABLED: '1' });
    if (!result) {
      throw new AppError(
        'the GitHub CLI (gh) is required to create the repository automatically. ' +
          'Install it from https://cli.github.com and run `gh auth login`, ' +
          'or pass the URL of a private repository: init <url>',
        ExitCode.Usage,
      );
    }
    return result;
  }

  /** Runs gh and returns trimmed stdout, or throws an AppError with gh's message. */
  async must(args: readonly string[]): Promise<string> {
    const result = await this.run(args);
    if (result.code === 0) return result.stdout.trim();
    const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new AppError(`gh ${args.slice(0, 2).join(' ')} failed: ${reason}`);
  }
}
