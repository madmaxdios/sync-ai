import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { FileState } from '../domain/file-state';
import { formatList } from '../domain/report';
import { copyPreserving, isDirectory, pathExists, pruneEmptyDirs, removeFile, toNativePath } from '../infra/file-system';
import { loadState, saveState } from '../infra/state-store';
import type { SyncState } from '../domain/sync-state';
import type { CommandContext } from './context';
import { agentRepoDir, listLocalFiles, requireRepo } from './local-tree';
import { refreshRemote, requireReachable } from './remote-state';
import { readRepoSnapshot } from './repo-snapshot';
import { scanFilesForSecrets } from './scan-secrets';
import { buildPlan, entriesIn, recordInSyncBases, type PlanEntry, type SyncPlan } from './sync-plan';

function rels(entries: readonly PlanEntry[]): string[] {
  return entries.map((entry) => entry.rel);
}

function printPushPreview(context: CommandContext, plan: SyncPlan): void {
  context.io.info('[dry-run] Changes that would be published (local → repository):');
  const lines = [
    ...formatList('+', rels(entriesIn(plan, FileState.NewLocal))),
    ...formatList('~', rels(entriesIn(plan, FileState.LocalChanged))),
    ...formatList('-', rels(entriesIn(plan, FileState.LocalDeleted))),
  ];
  for (const line of lines) context.io.info(line);
  if (lines.length === 0) context.io.info('  (none)');
}

/** Applies exactly the planned changes to <repo>/<agent>; nothing else is added or removed. */
async function applyToRepo(
  context: CommandContext,
  toCopy: readonly string[],
  toDelete: readonly string[],
): Promise<void> {
  const repoRoot = agentRepoDir(context);
  for (const rel of toDelete) await removeFile(toNativePath(repoRoot, rel));
  for (const rel of toCopy) {
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

/** Records the repository versions that now match the local files as the new bases. */
async function refreshBases(context: CommandContext, state: SyncState): Promise<void> {
  const snapshot = await readRepoSnapshot(context, 'HEAD');
  const plan = await buildPlan(context, snapshot, state);
  await saveState(context.dataHome, recordInSyncBases(state, context.agent.name, plan));
}

function refuseConflicts(context: CommandContext, conflicts: readonly PlanEntry[]): ExitCode {
  context.io.warn('Push cancelled: these files changed on both sides, so publishing would overwrite work:');
  for (const line of formatList('!', rels(conflicts))) context.io.warn(line);
  context.io.warn("Run 'pull' to refresh the comparison copies, then 'resolve' each file.");
  return ExitCode.Conflicts;
}

export async function runPush(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoGit, dataHome } = context;
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

  const loaded = await loadState(dataHome);
  const plan = await buildPlan(context, await readRepoSnapshot(context, 'HEAD'), loaded.state);

  const conflicts = entriesIn(plan, FileState.Conflict);
  if (conflicts.length > 0) return refuseConflicts(context, conflicts);

  const stale = entriesIn(plan, FileState.RepoChanged);
  if (stale.length > 0) {
    throw new AppError(
      `the repository has newer versions of ${stale.length} file(s) than this device ` +
        `(${rels(stale).join(', ')}). Run 'pull' before 'push'.`,
    );
  }

  const toCopy = rels(entriesIn(plan, FileState.LocalChanged, FileState.NewLocal));
  const toDelete = rels(entriesIn(plan, FileState.LocalDeleted));
  const removedUpstream = entriesIn(plan, FileState.RepoDeleted);
  if (removedUpstream.length > 0) {
    io.info('Not re-publishing files that were removed from the repository (local copies kept):');
    for (const line of formatList('-', rels(removedUpstream))) io.info(line);
  }

  if (context.dryRun) {
    printPushPreview(context, plan);
    return ExitCode.Ok;
  }

  await applyToRepo(context, toCopy, toDelete);
  await stageAllowedPaths(context);

  if (await repoGit.succeeds(['diff', '--cached', '--quiet'])) {
    if (remote.ahead === 0) {
      io.info('No changes to publish.');
      await refreshBases(context, loaded.state);
      return ExitCode.Ok;
    }
    io.info(`No new changes; publishing ${remote.ahead} pending commit(s).`);
  } else {
    io.info((await repoGit.must(['diff', '--cached', '--stat'])).trimEnd());
    const host = context.hostname.split('.')[0] || 'device';
    await commitStaged(context, `chore(sync): update ${agent.name} config from ${host}`);
  }

  await repoGit.must(['push', '--quiet', '-u', 'origin', 'HEAD']);
  await refreshBases(context, loaded.state);
  io.info('Published.');
  return ExitCode.Ok;
}
