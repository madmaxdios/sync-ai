import path from 'node:path';
import { AppError, UsageError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { isDirectory } from '../infra/file-system';
import { cloneRepository } from './clone-repo';
import type { CommandContext } from './context';
import { runInitWithGitHub } from './init-with-github';

export async function runInit(context: CommandContext): Promise<ExitCode> {
  const { argument: url, repoDir, io, repoGit } = context;
  if (!url) return runInitWithGitHub(context);
  if (context.repoName !== undefined) {
    throw new UsageError('--name only applies when init is run without a URL');
  }

  if (await isDirectory(path.join(repoDir, '.git'))) {
    const existing = await repoGit.run(['remote', 'get-url', 'origin']);
    const current = existing.code === 0 ? existing.stdout.trim() : '';
    if (current === url) {
      io.info(`Already initialized: ${repoDir}`);
      return ExitCode.Ok;
    }
    throw new AppError(`a clone already exists at ${repoDir} pointing to '${current}'`);
  }

  if (context.dryRun) {
    io.info(`[dry-run] Would clone ${url} into ${repoDir}`);
    return ExitCode.Ok;
  }

  await cloneRepository(context, url);
  io.info(`Initialized: ${repoDir}`);
  io.warn(
    'Warning: use a PRIVATE repository. Your skills and instructions may contain sensitive data.',
  );
  return ExitCode.Ok;
}
