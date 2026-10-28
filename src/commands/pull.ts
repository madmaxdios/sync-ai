import { AppError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { FileState } from '../domain/file-state';
import { formatList } from '../domain/report';
import { loadState, saveState } from '../infra/state-store';
import { installFromSnapshot, removeLocalWithBackup } from './apply-repo';
import { conflictStoreOf, recordConflicts } from './conflict-area';
import type { CommandContext } from './context';
import { requireRepo } from './local-tree';
import { refreshRemote, requireReachable } from './remote-state';
import { readRepoSnapshot } from './repo-snapshot';
import { buildPlan, entriesIn, recordInSyncBases, type PlanEntry, type SyncPlan } from './sync-plan';

function rels(entries: readonly PlanEntry[]): string[] {
  return entries.map((entry) => entry.rel);
}

function printPlan(context: CommandContext, plan: SyncPlan): void {
  const lines = [
    ...formatList('+', rels(entriesIn(plan, FileState.NewRepo))),
    ...formatList('~', rels(entriesIn(plan, FileState.RepoChanged))),
    ...formatList('!', rels(entriesIn(plan, FileState.Conflict))),
  ];
  const counts =
    `New files: ${entriesIn(plan, FileState.NewRepo).length}; ` +
    `updated from the repository: ${entriesIn(plan, FileState.RepoChanged).length}; ` +
    `conflicts: ${entriesIn(plan, FileState.Conflict).length}`;
  context.io.info(counts);
  for (const line of lines) context.io.info(line);
}

function reportOpenConflicts(context: CommandContext, open: readonly string[]): void {
  const { io } = context;
  io.warn('Conflicts (changed on both sides): your local files were NOT modified.');
  for (const line of formatList('!', open)) io.warn(line);
  io.warn(`Copies for comparison: ${conflictStoreOf(context).directory}`);
  io.warn(
    "Run 'resolve' to review them, or repeat with --yes to take the repository version " +
      'for all of them (a .backup-* copy is kept).',
  );
}

function reportKeptLocalFiles(context: CommandContext, plan: SyncPlan): void {
  const { io } = context;
  const pending = entriesIn(
    plan,
    FileState.LocalChanged,
    FileState.NewLocal,
    FileState.LocalDeleted,
  );
  if (pending.length > 0) {
    io.info(`${pending.length} local change(s) are waiting to be published (run 'push').`);
  }
  const removed = entriesIn(plan, FileState.RepoDeleted);
  if (removed.length > 0) {
    io.info('These files were removed from the repository; your local copies were kept:');
    for (const line of formatList('-', rels(removed))) io.info(line);
  }
}

export async function runPull(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoGit, dataHome } = context;
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

  const snapshot = await readRepoSnapshot(context, 'HEAD');
  if (snapshot.blobs.size === 0) {
    io.info(`The repository does not contain any '${agent.name}' files yet.`);
    return ExitCode.Ok;
  }

  const loaded = await loadState(dataHome);
  if (loaded.invalid) {
    io.warn('The sync state file is unreadable and was ignored: differing files count as conflicts.');
  }
  const plan = await buildPlan(context, snapshot, loaded.state);
  const toInstall = entriesIn(plan, FileState.NewRepo, FileState.RepoChanged);
  const conflicts = entriesIn(plan, FileState.Conflict);

  if (toInstall.length === 0 && conflicts.length === 0) {
    const pending = entriesIn(plan, FileState.LocalChanged, FileState.NewLocal, FileState.LocalDeleted);
    if (pending.length === 0 && entriesIn(plan, FileState.RepoDeleted).length === 0) {
      io.info(`Everything is up to date: ${agent.home} already matches the repository.`);
    } else {
      io.info('Nothing to pull from the repository.');
      reportKeptLocalFiles(context, plan);
    }
    if (!context.dryRun) await saveState(dataHome, recordInSyncBases(loaded.state, agent.name, plan));
    return ExitCode.Ok;
  }

  printPlan(context, plan);

  if (context.dryRun) {
    io.info(`[dry-run] ${agent.home} was not modified.`);
    return conflicts.length > 0 ? ExitCode.Conflicts : ExitCode.Ok;
  }

  await installFromSnapshot(context, snapshot, rels(toInstall));

  // --yes only ever settles conflicts, and always in favor of the repository.
  const settled: PlanEntry[] = [];
  if (context.assumeYes) {
    for (const entry of conflicts) {
      if (entry.repoBlob) await installFromSnapshot(context, snapshot, [entry.rel]);
      else await removeLocalWithBackup(context, entry.rel);
      settled.push(entry);
    }
  }
  const open = await recordConflicts(context, plan, new Set(rels(settled)));

  const next = recordInSyncBases(loaded.state, agent.name, plan, [...toInstall, ...settled]);
  await saveState(dataHome, next);

  const applied = toInstall.length + settled.length;
  if (applied > 0) io.info(`Installed ${applied} file(s) into ${agent.home}.`);
  reportKeptLocalFiles(context, plan);
  if (open.length === 0) return ExitCode.Ok;
  reportOpenConflicts(context, open);
  return ExitCode.Conflicts;
}
