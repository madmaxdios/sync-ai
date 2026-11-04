import path from 'node:path';
import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { isDirectory } from '../infra/file-system';
import { cloneRepository } from './clone-repo';
import type { CommandContext } from './context';
import { runInitWithGitHub } from './init-with-github';
import { listRepoFiles } from './local-tree';
import { runPull } from './pull';
import { refreshRemote, requireReachable } from './remote-state';

/** Environment variable that points sync-ai at an explicit private repository instead of using gh. */
export const REPO_URL_ENV = 'AGENT_SYNC_REPO_URL';

export async function hasLocalRepository(context: CommandContext): Promise<boolean> {
  return isDirectory(path.join(context.repoDir, '.git'));
}

async function cloneFromUrl(context: CommandContext, url: string): Promise<ExitCode> {
  const { io, repoDir, repoGit } = context;
  if (context.dryRun) {
    io.info(`[dry-run] Would clone ${url} into ${repoDir}`);
    return ExitCode.Ok;
  }
  await cloneRepository(context, url);
  io.info(`Initialized: ${repoDir}`);
  io.warn('Warning: use a PRIVATE repository. Your skills and instructions may contain sensitive data.');

  const remote = requireReachable(await refreshRemote(repoGit));
  if (remote.status === 'empty' || (await listRepoFiles(context)).length === 0) {
    io.info(`The repository has no '${context.agent.name}' files yet.`);
    return ExitCode.Ok;
  }
  return runPull({ ...context, assumeYes: false });
}

/**
 * First-run setup, done by `sync` (and by the agent's hooks) when this device has no local clone
 * yet: clones the private data repository and installs its files. `allowCreate` lets a manual
 * run also create the repository on GitHub; hooks never do.
 */
export async function bootstrapRepository(context: CommandContext, allowCreate: boolean): Promise<ExitCode> {
  const url = context.env[REPO_URL_ENV]?.trim();
  if (url) {
    if (context.repoName !== undefined) {
      throw new AppError(`--name cannot be combined with ${REPO_URL_ENV}`);
    }
    return cloneFromUrl(context, url);
  }
  return runInitWithGitHub(context, allowCreate);
}
