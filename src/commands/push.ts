import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { formatList } from '../domain/report';
import { copyPreserving, isDirectory, pathExists, pruneEmptyDirs, removeFile, toNativePath } from '../infra/file-system';
import type { CommandContext } from './context';
import {
  agentRepoDir,
  compareWithRepo,
  listLocalFiles,
  listRepoFiles,
  requireRepo,
} from './local-tree';
import { refreshRemote, requireReachable } from './remote-state';
import { scanFilesForSecrets } from './scan-secrets';

async function printPushPreview(context: CommandContext): Promise<void> {
  const { onlyLocal, modified, onlyRepo } = await compareWithRepo(context);
  context.io.info('[dry-run] Changes that would be published (local → repository):');
  const lines = [
    ...formatList('+', onlyLocal),
    ...formatList('~', modified),
    ...formatList('-', onlyRepo),
  ];
  for (const line of lines) context.io.info(line);
  if (lines.length === 0) context.io.info('  (none)');
}

/** Makes <repo>/<agent> mirror the allowlisted local files. */
async function mirrorToRepo(context: CommandContext, files: readonly string[]): Promise<void> {
  const repoRoot = agentRepoDir(context);
  const localFiles = new Set(files);
  for (const rel of await listRepoFiles(context)) {
    if (!localFiles.has(rel)) await removeFile(toNativePath(repoRoot, rel));
  }
  for (const rel of files) {
    await copyPreserving(toNativePath(context.agent.home, rel), toNativePath(repoRoot, rel));
  }
  await pruneEmptyDirs(repoRoot);
}

/** Stages only allowlisted paths; never the whole working tree. */
async function stageAllowedPaths(context: CommandContext): Promise<void> {
  for (const entry of context.agent.allow) {
    const gitPath = `${context.agent.name}/${entry}`;
    const exists =
      (await pathExists(toNativePath(context.repoDir, gitPath))) ||
      (await context.repoGit.succeeds(['ls-files', '--error-unmatch', '--', gitPath]));
    if (exists) await context.repoGit.must(['add', '-A', '--', gitPath]);
  }
}

async function commitStaged(context: CommandContext, message: string): Promise<void> {
  const { repoGit } = context;
  const hasIdentity =
    (await repoGit.succeeds(['config', 'user.name'])) &&
    (await repoGit.succeeds(['config', 'user.email']));
  const identity = hasIdentity
    ? []
    : ['-c', 'user.name=agent-sync', '-c', 'user.email=agent-sync@localhost'];
  await repoGit.must([...identity, 'commit', '--quiet', '-m', message]);
}

export async function runPush(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoGit } = context;
  await requireRepo(context);
  if (!(await isDirectory(agent.home))) throw new AppError(`${agent.home} does not exist`);

  const files = await listLocalFiles(context);
  if (files.length === 0) {
    throw new AppError(`no files to sync in ${agent.home}`);
  }

  io.info(`Scanning ${files.length} file(s) for secrets...`);
  if ((await scanFilesForSecrets(context, files)) > 0) {
    io.warn('Push cancelled: possible secrets detected (their contents are not shown).');
    io.warn('Remove them or move them out of the synced configuration, then try again.');
    return ExitCode.SecretsDetected;
  }

  const remote = requireReachable(await refreshRemote(repoGit));
  if (remote.behind > 0) {
    throw new AppError(
      `the remote has ${remote.behind} commit(s) you do not have. Run 'pull' before 'push'.`,
    );
  }

  if (context.dryRun) {
    await printPushPreview(context);
    return ExitCode.Ok;
  }

  await mirrorToRepo(context, files);
  await stageAllowedPaths(context);

  if (await repoGit.succeeds(['diff', '--cached', '--quiet'])) {
    if (remote.ahead === 0) {
      io.info('No changes to publish.');
      return ExitCode.Ok;
    }
    io.info(`No new changes; publishing ${remote.ahead} pending commit(s).`);
  } else {
    io.info((await repoGit.must(['diff', '--cached', '--stat'])).trimEnd());
    const host = context.hostname.split('.')[0] || 'device';
    await commitStaged(context, `chore(sync): update ${agent.name} config from ${host}`);
  }

  await repoGit.must(['push', '--quiet', '-u', 'origin', 'HEAD']);
  io.info('Published.');
  return ExitCode.Ok;
}
