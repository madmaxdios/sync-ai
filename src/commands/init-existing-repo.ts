import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { cloneUrl, parseGitProtocol, type RepoInfo } from '../domain/github-repo';
import { cloneRepository } from './clone-repo';
import type { CommandContext } from './context';
import { listRepoFiles } from './local-tree';
import { runPull } from './pull';
import { refreshRemote, requireReachable } from './remote-state';

/**
 * `init` without a URL when `<login>/<name>` already exists: this is the user's data
 * repository, so a second device clones it and installs its configuration.
 */
export async function runInitWithExistingRepository(
  context: CommandContext,
  slug: string,
  info: RepoInfo,
): Promise<ExitCode> {
  const { gh, io, repoDir, repoGit } = context;

  if (!info.isPrivate) {
    throw new AppError(
      `the repository ${info.url} already exists but GitHub reports it as PUBLIC, ` +
        'and sync-ai never uses a public repository for configuration. ' +
        'Make it private, choose another name with --name <repo>, or pass the URL of a private repository: init <url>',
    );
  }

  if (context.dryRun) {
    io.info(
      `[dry-run] Would clone the existing PRIVATE repository ${slug} into ${repoDir} and install its configuration`,
    );
    return ExitCode.Ok;
  }

  if (!context.assumeYes) {
    const confirmed = await io.confirm(
      `Clone the existing PRIVATE repository ${slug} into ${repoDir} and install its configuration? (y/N) `,
    );
    if (!confirmed) {
      io.warn('Cancelled: nothing was cloned.');
      io.warn(`Repeat with --yes to clone the existing private repository ${slug}.`);
      return ExitCode.ConfirmationRequired;
    }
  }

  const protocol = parseGitProtocol((await gh.run(['config', 'get', 'git_protocol'])).stdout);
  await cloneRepository(context, cloneUrl(info, protocol), {
    withGhCredentials: protocol === 'https',
  });
  io.info(`Cloned the existing private repository ${info.url}`);
  io.info(`Initialized: ${repoDir}`);

  const remote = requireReachable(await refreshRemote(repoGit));
  if (remote.status === 'empty' || (await listRepoFiles(context)).length === 0) {
    io.info(`The repository has no '${context.agent.name}' files yet.`);
    io.info("Next step: run 'push' to upload your configuration.");
    return ExitCode.Ok;
  }

  // --yes confirmed the clone only: overwriting local files needs its own explicit `pull --yes`.
  const pulled = await runPull({ ...context, assumeYes: false });
  if (pulled === ExitCode.ConfirmationRequired) {
    io.warn(`The repository is cloned and initialized, but your local files in ${context.agent.home} were not changed.`);
    io.warn("Review the list above and run 'pull --yes' to overwrite them; a .backup-* copy will be kept.");
  }
  return pulled;
}
