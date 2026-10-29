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
import { filesWithFindings, printFindings, scanFilesToPublish, type PathFinding } from './scan-secrets';
import { buildPlan, entriesIn, recordInSyncBases, type PlanEntry, type SyncPlan } from './sync-plan';

function rels(entries: readonly PlanEntry[]): string[] {
  return entries.map((entry) => entry.rel);
}

export interface PushOptions {
  /** False for the automatic push: local deletions are only counted, never published. */
  readonly allowDeletions: boolean;
}

export interface PushResult {
  readonly code: ExitCode;
  /** Files copied into the repository (and deleted from it) by this push. */
  readonly published: readonly string[];
  /** Local deletions that were not published (only when deletions are not allowed). */
  readonly deletionsPending: number;
  /** Short id of the commit the repository ends up at, when something was published. */
  readonly commit: string | undefined;
  /** What the scanner refused to publish (exit code 4). */
  readonly findings: readonly PathFinding[];
}

function outcome(code: ExitCode, parts: Partial<Omit<PushResult, 'code'>> = {}): PushResult {
  return { code, published: [], deletionsPending: 0, commit: undefined, findings: [], ...parts };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function printPushPreview(context: CommandContext, plan: SyncPlan, toDelete: readonly string[]): void {
  context.io.info('[dry-run] Changes that would be published (local → repository):');
  const lines = [
    ...formatList('+', rels(entriesIn(plan, FileState.NewLocal))),
    ...formatList('~', rels(entriesIn(plan, FileState.LocalChanged))),
    ...formatList('-', toDelete),
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

/** Publishes the listed local changes. A refused push returns its exit code instead of throwing. */
export async function executePush(context: CommandContext, options: PushOptions): Promise<PushResult> {
  const { agent, io, repoGit, dataHome } = context;
  await requireRepo(context);
  if (!(await isDirectory(agent.home))) throw new AppError(`${agent.home} does not exist`);

  const everyFile = await listLocalFiles(context);
  if (everyFile.length === 0) {
    throw new AppError(`no files to sync in ${agent.home}`);
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
  if (conflicts.length > 0) return outcome(refuseConflicts(context, conflicts));

  const stale = entriesIn(plan, FileState.RepoChanged);
  if (stale.length > 0) {
    throw new AppError(
      `the repository has newer versions of ${stale.length} file(s) than this device ` +
        `(${rels(stale).join(', ')}). Run 'pull' before 'push'.`,
    );
  }

  const toCopy = rels(entriesIn(plan, FileState.LocalChanged, FileState.NewLocal));
  const allDeletions = rels(entriesIn(plan, FileState.LocalDeleted));
  const toDelete = options.allowDeletions ? allDeletions : [];
  const deletionsPending = options.allowDeletions ? 0 : allDeletions.length;
  const removedUpstream = entriesIn(plan, FileState.RepoDeleted);
  if (removedUpstream.length > 0) {
    io.info('Not re-publishing files that were removed from the repository (local copies kept):');
    for (const line of formatList('-', rels(removedUpstream))) io.info(line);
  }
  if (plan.unlisted.length > 0) {
    io.info(`${plural(plan.unlisted.length, 'item')} not synced and not published (see 'status --all'; list one with 'add').`);
  }

  io.info(`Scanning ${plural(toCopy.length, 'file')} for secrets, passwords and personal data...`);
  const findings = await scanFilesToPublish(context, toCopy);
  if (findings.length > 0) {
    io.warn(
      `Push cancelled: ${plural(filesWithFindings(findings), 'file')} may contain secrets, passwords or personal data ` +
        '(the contents are not shown):',
    );
    printFindings(io, findings);
    io.warn('Remove them, or add the marker sync-ai:allow to a line that is a harmless example, then try again.');
    return outcome(ExitCode.SecretsDetected, { findings, deletionsPending });
  }

  if (context.dryRun) {
    printPushPreview(context, plan, toDelete);
    return outcome(ExitCode.Ok, { deletionsPending });
  }

  await applyToRepo(context, toCopy, toDelete);
  await stageAllowedPaths(context);

  if (await repoGit.succeeds(['diff', '--cached', '--quiet'])) {
    if (remote.ahead === 0) {
      io.info('No changes to publish.');
      await refreshBases(context, loaded.state);
      return outcome(ExitCode.Ok, { deletionsPending });
    }
    io.info(`No new changes; publishing ${remote.ahead} pending commit(s).`);
  } else {
    io.info((await repoGit.must(['diff', '--cached', '--stat'])).trimEnd());
    const host = context.hostname.split('.')[0] || 'device';
    await commitStaged(context, `chore(sync): update ${agent.name} config from ${host}`);
  }

  await repoGit.must(['push', '--quiet', '-u', 'origin', 'HEAD']);
  await refreshBases(context, loaded.state);
  const commit = (await repoGit.must(['rev-parse', '--short', 'HEAD'])).trim();
  io.info('Published.');
  return outcome(ExitCode.Ok, { published: [...toCopy, ...toDelete], commit, deletionsPending });
}

export async function runPush(context: CommandContext): Promise<ExitCode> {
  return (await executePush(context, { allowDeletions: true })).code;
}
