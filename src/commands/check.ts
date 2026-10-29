import path from 'node:path';
import type { AutoPushOutcome } from '../domain/auto-push';
import { buildReport, shouldAutoPull, type CheckFacts } from '../domain/check-decision';
import {
  intervalFrom,
  isRemoteCheckDue,
  shouldAnnounce,
  withAnnouncement,
  withAutoPushFailure,
  withRemoteCheck,
  type CheckCache,
} from '../domain/check-cache';
import { CheckEvent } from '../domain/check-event';
import { ExitCode } from '../domain/exit-code';
import { FileState } from '../domain/file-state';
import { formatHookOutput, manualInput, parseHookInput, type HookInput } from '../domain/hook-input';
import { formatList } from '../domain/report';
import { basesOf, type SyncState } from '../domain/sync-state';
import { loadCheckCache, saveCheckCache } from '../infra/check-cache-store';
import { startDeadline } from '../infra/deadline';
import { isDirectory } from '../infra/file-system';
import { SILENT_IO } from '../infra/io';
import { loadState } from '../infra/state-store';
import { runAutoPush } from './auto-push';
import { countAhead, countBehind, probeRemote } from './check-remote';
import type { CommandContext } from './context';
import { runPull } from './pull';
import { readRepoSnapshot } from './repo-snapshot';
import { buildPlan, entriesIn } from './sync-plan';

/** A check must never keep the user waiting: looking for news on the remote fits in this budget. */
const CHECK_BUDGET_MS = 4000;
/** The whole run, including a pull and a push, stays under the 8 seconds the hook is given. */
const OVERALL_BUDGET_MS = 7000;

interface Findings {
  /** New and changed local files of the opt-in list: what a push would publish. */
  readonly pushFiles: readonly string[];
  /** Local files classified as added, changed or deleted. */
  readonly pushChanges: readonly { readonly prefix: '+' | '~' | '-'; readonly rel: string }[];
  /** Local files deleted here that the repository still has. */
  readonly deletions: number;
  readonly toPull: number;
  /** Repository files classified as added, changed or deleted. */
  readonly pullChanges: readonly { readonly prefix: '+' | '~' | '-'; readonly rel: string }[];
  readonly conflicts: number;
  readonly conflictFiles: readonly string[];
}

const NO_FINDINGS: Findings = {
  pushFiles: [],
  pushChanges: [],
  deletions: 0,
  toPull: 0,
  pullChanges: [],
  conflicts: 0,
  conflictFiles: [],
};
const AUTO_PUSH_OFF: AutoPushOutcome = { kind: 'off' };

async function compare(context: CommandContext, state: SyncState, ref: string): Promise<Findings> {
  const snapshot = await readRepoSnapshot(context, ref);
  const plan = await buildPlan(context, snapshot, state);
  const pushChanges = [
    ...entriesIn(plan, FileState.NewLocal).map((entry) => ({ prefix: '+' as const, rel: entry.rel })),
    ...entriesIn(plan, FileState.LocalChanged).map((entry) => ({ prefix: '~' as const, rel: entry.rel })),
    ...entriesIn(plan, FileState.LocalDeleted).map((entry) => ({ prefix: '-' as const, rel: entry.rel })),
  ];
  const pullChanges = [
    ...entriesIn(plan, FileState.NewRepo).map((entry) => ({ prefix: '+' as const, rel: entry.rel })),
    ...entriesIn(plan, FileState.RepoChanged).map((entry) => ({ prefix: '~' as const, rel: entry.rel })),
    ...entriesIn(plan, FileState.RepoDeleted).map((entry) => ({ prefix: '-' as const, rel: entry.rel })),
  ];
  const conflictFiles = entriesIn(plan, FileState.Conflict).map((entry) => entry.rel);
  return {
    pushFiles: entriesIn(plan, FileState.NewLocal, FileState.LocalChanged).map((entry) => entry.rel),
    pushChanges,
    deletions: pushChanges.filter((entry) => entry.prefix === '-').length,
    toPull: entriesIn(plan, FileState.NewRepo, FileState.RepoChanged).length,
    pullChanges,
    conflicts: conflictFiles.length,
    conflictFiles,
  };
}

function printDetectedChanges(context: CommandContext, findings: Findings): void {
  const { io } = context;
  if (findings.pushChanges.length > 0) {
    io.info('Changes to publish (local → repository):');
    for (const entry of findings.pushChanges) {
      for (const line of formatList(entry.prefix, [entry.rel])) io.info(line);
    }
  }
  if (findings.pullChanges.length > 0) {
    io.info('Changes to pull (repository → local):');
    for (const entry of findings.pullChanges) {
      for (const line of formatList(entry.prefix, [entry.rel])) io.info(line);
    }
  }
  if (findings.conflictFiles.length > 0) {
    io.info('Conflicts (changed on both sides):');
    for (const line of formatList('!', findings.conflictFiles)) io.info(line);
  }
}

/** Applies the repository changes with the normal pull (same backups; conflicts are never overwritten). */
async function pullQuietly(context: CommandContext, files: number): Promise<number> {
  try {
    const code = await runPull({ ...context, io: SILENT_IO, assumeYes: false, dryRun: false });
    return code === ExitCode.Ok ? files : 0;
  } catch {
    return 0;
  }
}

function announce(
  context: CommandContext,
  input: HookInput,
  cache: CheckCache,
  message: { readonly user: string; readonly claude: string | undefined; readonly signature: string },
): CheckCache {
  const manual = !context.hook;
  const now = context.now();
  if (!manual && !context.dryRun && !shouldAnnounce(cache, input.sessionId, message.signature, now)) return cache;
  context.io.info(manual ? message.user : formatHookOutput(input, message));
  if (manual || context.dryRun) return cache;
  return withAnnouncement(cache, input.sessionId, message.signature, now);
}

async function check(context: CommandContext): Promise<void> {
  const { agent, dataHome, repoGit } = context;
  const manual = !context.hook;
  const input = manual ? manualInput() : parseHookInput(await context.readStdin());
  if (!(await isDirectory(path.join(context.repoDir, '.git')))) return;

  const probeDeadline = startDeadline(CHECK_BUDGET_MS);
  const overallDeadline = startDeadline(OVERALL_BUDGET_MS);
  const now = context.now();
  let state = await loadState(dataHome);
  const hasBaseline = !state.invalid && Object.keys(basesOf(state.state, agent.name)).length > 0;
  let cache = await loadCheckCache(dataHome);
  const before = cache;

  const branch = (await repoGit.must(['symbolic-ref', '--short', 'HEAD'])).trim();
  const interval = intervalFrom(context.env.AGENT_SYNC_CHECK_INTERVAL_MINUTES);
  const remoteDue =
    hasBaseline && (manual || input.event === CheckEvent.SessionStart || isRemoteCheckDue(cache, now, interval));
  if (remoteDue) {
    // The outcome only matters through the refs it updates; an unreachable remote is not an error.
    await probeRemote(repoGit, branch, probeDeadline);
    cache = withRemoteCheck(cache, now);
  }

  let behind = await countBehind(repoGit, branch);
  let findings = hasBaseline ? await compare(context, state.state, behind > 0 ? `origin/${branch}` : 'HEAD') : NO_FINDINGS;
  const factsOf = (): CheckFacts => ({
    event: input.event,
    hasBaseline,
    behind,
    toPush: findings.pushFiles.length,
    deletions: findings.deletions,
    toPull: findings.toPull,
    conflicts: findings.conflicts,
  });

  const pulled = shouldAutoPull(factsOf()) && !context.dryRun ? await pullQuietly(context, findings.toPull) : 0;
  if (pulled > 0) {
    // The pull moved the clone and recorded new bases: look again before deciding about a push.
    state = await loadState(dataHome);
    behind = await countBehind(repoGit, branch);
    findings = await compare(context, state.state, 'HEAD');
  }

  let autoPush: AutoPushOutcome = AUTO_PUSH_OFF;
  if (manual) printDetectedChanges(context, findings);
  if (hasBaseline) {
    const run = await runAutoPush(context, {
      event: input.event,
      hasBaseline,
      conflicts: findings.conflicts,
      toPull: findings.toPull,
      behind,
      ahead: await countAhead(repoGit, branch),
      pushFiles: findings.pushFiles,
      cache,
      retryMinutes: interval,
      deadline: overallDeadline,
    });
    autoPush = run.outcome;
    if (run.failed && !context.dryRun) cache = withAutoPushFailure(cache, now);
    if (autoPush.kind === 'pushed') findings = await compare(context, (await loadState(dataHome)).state, 'HEAD');
  }

  const report = buildReport(factsOf(), { pulled, dryRun: context.dryRun, autoPush });

  if (report) cache = announce(context, input, cache, report);
  else if (manual && !context.quiet) context.io.info('sync-ai: in sync.');

  if (!context.dryRun && cache !== before) await saveCheckCache(dataHome, cache);
}

/** Tells whether this device is out of sync. It always exits 0 and prints nothing on any failure. */
export async function runCheck(context: CommandContext): Promise<ExitCode> {
  if (context.env.AGENT_SYNC_CHECK === '0') return ExitCode.Ok;
  try {
    await check(context);
  } catch {
    // A hook that fails or talks must never get in the user's way.
  }
  return ExitCode.Ok;
}
