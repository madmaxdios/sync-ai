import { AppError, UsageError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import {
  cloneUrl,
  isRepoNotFound,
  parseGitProtocol,
  parseRepoInfo,
  type RepoInfo,
} from '../domain/github-repo';
import { DEFAULT_REPO_NAME, repoNameSchema } from '../domain/repo-name';
import type { GitHubCli } from '../infra/gh';
import { cloneRepository } from './clone-repo';
import type { CommandContext } from './context';
import { runInitWithExistingRepository } from './init-existing-repo';

const REPO_DESCRIPTION = 'AI agent configuration synced with sync-ai';

/** Returns the repository when it exists and undefined when GitHub says it does not. */
async function findRepository(gh: GitHubCli, slug: string): Promise<RepoInfo | undefined> {
  const result = await gh.run(['repo', 'view', slug, '--json', 'isPrivate,url,sshUrl']);
  if (result.code === 0) return parseRepoInfo(result.stdout);
  if (isRepoNotFound(result.stderr)) return undefined;
  throw new AppError(`gh repo view failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
}

async function requireAuthenticatedLogin(gh: GitHubCli): Promise<string> {
  const status = await gh.run(['auth', 'status']);
  if (status.code !== 0) {
    throw new AppError(
      'gh is not logged in to GitHub. Run `gh auth login`, or set AGENT_SYNC_REPO_URL to the URL of a private repository',
      ExitCode.Usage,
    );
  }
  const login = await gh.must(['api', 'user', '--jq', '.login']);
  if (!login) throw new AppError('gh did not return your GitHub username');
  return login;
}

/**
 * First-run setup through the GitHub CLI: clones the user's existing private data repository
 * and installs its files, or (only when `allowCreate`) creates the PRIVATE repository and clones it.
 */
export async function runInitWithGitHub(
  context: CommandContext,
  allowCreate: boolean,
): Promise<ExitCode> {
  const { gh, io, repoDir } = context;

  const parsedName = repoNameSchema.safeParse(context.repoName ?? DEFAULT_REPO_NAME);
  if (!parsedName.success) {
    throw new UsageError(
      'invalid repository name: use letters, digits, ".", "_" or "-" (it cannot start with "-" or end with ".git")',
    );
  }
  const name = parsedName.data;

  const login = await requireAuthenticatedLogin(gh);
  const slug = `${login}/${name}`;
  const existing = await findRepository(gh, slug);
  if (existing) return runInitWithExistingRepository(context, slug, existing);
  if (!allowCreate) {
    throw new AppError(
      `the private repository ${slug} does not exist yet; run /sync-ai:sync (or agent-sync sync) to create it`,
    );
  }

  if (context.dryRun) {
    io.info(`[dry-run] Would create the PRIVATE repository ${slug} on GitHub and clone it into ${repoDir}`);
    return ExitCode.Ok;
  }

  if (!context.assumeYes) {
    const confirmed = await io.confirm(
      `Create the PRIVATE repository ${slug} on GitHub and use it for your configuration? (y/N) `,
    );
    if (!confirmed) {
      io.warn('Cancelled: nothing was created on GitHub.');
      io.warn(`Review it and repeat with --yes to create the private repository ${slug}.`);
      return ExitCode.ConfirmationRequired;
    }
  }

  await gh.must(['repo', 'create', name, '--private', '--description', REPO_DESCRIPTION]);

  const created = await findRepository(gh, slug);
  if (!created) throw new AppError(`gh created ${slug} but it cannot be found afterwards`);
  if (!created.isPrivate) {
    throw new AppError(
      `the repository ${created.url} was created but GitHub reports it is NOT private. ` +
        'Nothing was cloned or uploaded. Make it private or delete it, then run sync again.',
    );
  }

  const protocol = parseGitProtocol((await gh.run(['config', 'get', 'git_protocol'])).stdout);
  await cloneRepository(context, cloneUrl(created, protocol), {
    withGhCredentials: protocol === 'https',
  });

  io.info(`Created the private repository ${created.url}`);
  io.info(`Initialized: ${repoDir}`);
  io.info("Next step: add the skills you want to share and run 'push' to upload your configuration.");
  return ExitCode.Ok;
}
