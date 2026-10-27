import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { formatList, formatStamp } from '../domain/report';
import { copyPreserving, pathExists, toNativePath } from '../infra/file-system';
import type { CommandContext } from './context';
import { agentRepoDir, differsFromRepo, listRepoFiles, requireRepo } from './local-tree';
import { refreshRemote, requireReachable } from './remote-state';

interface PullPlan {
  readonly added: readonly string[];
  readonly changed: readonly string[];
}

async function planPull(context: CommandContext, repoFiles: readonly string[]): Promise<PullPlan> {
  const added: string[] = [];
  const changed: string[] = [];
  for (const rel of repoFiles) {
    if (!(await pathExists(toNativePath(context.agent.home, rel)))) {
      added.push(rel);
      continue;
    }
    if (await differsFromRepo(context, rel)) changed.push(rel);
  }
  return { added, changed };
}

async function install(context: CommandContext, files: readonly string[]): Promise<void> {
  const stamp = formatStamp(context.now());
  const repoRoot = agentRepoDir(context);
  for (const rel of files) {
    const destination = toNativePath(context.agent.home, rel);
    if (await pathExists(destination)) {
      await copyPreserving(destination, `${destination}.backup-${stamp}`);
    }
    await copyPreserving(toNativePath(repoRoot, rel), destination);
  }
}

export async function runPull(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoGit } = context;
  await requireRepo(context);
  const remote = requireReachable(await refreshRemote(repoGit));

  if (remote.status === 'empty') {
    io.info("The remote repository is empty. Use 'push' from the device that has your configuration.");
    return ExitCode.Ok;
  }

  if (remote.behind > 0) {
    const advanced = await repoGit.succeeds(['pull', '--quiet', '--ff-only', 'origin', remote.branch]);
    if (!advanced) {
      throw new AppError(
        'could not fast-forward the clone (are there unpublished local commits that diverge?)',
      );
    }
  }

  const repoFiles = await listRepoFiles(context);
  if (repoFiles.length === 0) {
    io.info(`The repository does not contain any '${agent.name}' files yet.`);
    return ExitCode.Ok;
  }

  const { added, changed } = await planPull(context, repoFiles);
  const total = added.length + changed.length;
  if (total === 0) {
    io.info(`Everything is up to date: ${agent.home} already matches the repository.`);
    return ExitCode.Ok;
  }

  io.info(`New files: ${added.length}; differing local files: ${changed.length}`);
  for (const line of [...formatList('+', added), ...formatList('~', changed)]) io.info(line);

  if (context.dryRun) {
    io.info(`[dry-run] ${agent.home} was not modified.`);
    return ExitCode.Ok;
  }

  if (changed.length > 0 && !context.assumeYes) {
    const confirmed = await io.confirm(
      'Local changes will be overwritten (a .backup-* copy is kept). Continue? (y/N) ',
    );
    if (!confirmed) {
      io.warn('Cancelled to protect your local files (marked with ~).');
      io.warn(
        'Review the list and repeat with --yes to overwrite them; a .backup-* copy will be kept.',
      );
      return ExitCode.ConfirmationRequired;
    }
  }

  await install(context, [...added, ...changed]);
  io.info(`Installed ${total} file(s) into ${agent.home}.`);
  io.info('Note: pull does not delete local files that no longer exist in the repository.');
  return ExitCode.Ok;
}
