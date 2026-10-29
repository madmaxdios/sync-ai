import { ExitCode } from '../domain/exit-code';
import { FileState } from '../domain/file-state';
import { describeRelation, formatList } from '../domain/report';
import { loadState } from '../infra/state-store';
import type { CommandContext } from './context';
import { requireRepo } from './local-tree';
import { refreshRemote, type RemoteState } from './remote-state';
import { readRepoSnapshot } from './repo-snapshot';
import { buildPlan, entriesIn, type PlanEntry, type SyncPlan } from './sync-plan';

function rels(entries: readonly PlanEntry[]): string[] {
  return entries.map((entry) => entry.rel);
}

/** Pending pull changes live on the remote when the clone is behind, so compare against it. */
function comparisonRef(remote: RemoteState): string {
  return remote.status === 'ready' && remote.behind > 0 ? `origin/${remote.branch}` : 'HEAD';
}

function printSection(context: CommandContext, title: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  context.io.info(title);
  for (const line of lines) context.io.info(line);
}

function printPlan(context: CommandContext, plan: SyncPlan): number {
  const toPush = [
    ...formatList('+', rels(entriesIn(plan, FileState.NewLocal))),
    ...formatList('~', rels(entriesIn(plan, FileState.LocalChanged))),
    ...formatList('-', rels(entriesIn(plan, FileState.LocalDeleted))),
  ];
  const toPull = [
    ...formatList('+', rels(entriesIn(plan, FileState.NewRepo))),
    ...formatList('~', rels(entriesIn(plan, FileState.RepoChanged))),
  ];
  const conflicts = formatList('!', rels(entriesIn(plan, FileState.Conflict)));
  const removed = formatList('-', rels(entriesIn(plan, FileState.RepoDeleted)));

  printSection(context, 'To push (local changes, run push):', toPush);
  printSection(context, 'To pull (repository changes, run pull):', toPull);
  printSection(
    context,
    'CONFLICT (changed on both sides; run resolve, push and pull will not overwrite them):',
    conflicts,
  );
  printSection(context, 'Removed from the repository (your local copies are kept):', removed);
  return toPush.length + toPull.length + conflicts.length + removed.length;
}

/** Items nobody listed are counted on one line; `--all` names them. */
function printUnlisted(context: CommandContext, plan: SyncPlan): void {
  const { unlisted } = plan;
  if (unlisted.length === 0) return;
  if (!context.all) {
    context.io.info(`${unlisted.length} item${unlisted.length === 1 ? '' : 's'} not synced; run status --all to list them`);
    return;
  }
  context.io.info('Not synced (list one with: add <skill|command|agent> <name>):');
  for (const line of formatList('·', unlisted)) context.io.info(line);
}

export async function runStatus(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoDir } = context;
  await requireRepo(context);
  io.info(`Agent:       ${agent.name}`);
  io.info(`Local:       ${agent.home}`);
  io.info(`Repository:  ${repoDir}`);

  const remote = await refreshRemote(context.repoGit);
  if (remote.status === 'unreachable') {
    io.warn(`Remote:      unreachable (${remote.error})`);
  } else if (remote.status === 'empty') {
    io.info("Remote:      empty (use 'push' to publish)");
  } else {
    io.info(`Remote:      ${describeRelation(remote.ahead, remote.behind)}`);
  }

  const loaded = await loadState(context.dataHome);
  if (loaded.invalid) io.warn('The sync state file is unreadable: differing files count as conflicts.');
  const snapshot = await readRepoSnapshot(context, comparisonRef(remote));
  const plan = await buildPlan(context, snapshot, loaded.state);

  const differences = printPlan(context, plan);
  if (differences === 0) io.info('Local and repository: no differences.');
  else if (entriesIn(plan, FileState.Conflict).length > 0) io.info("Next step: run 'resolve' to review the conflicts.");
  printUnlisted(context, plan);
  return ExitCode.Ok;
}
