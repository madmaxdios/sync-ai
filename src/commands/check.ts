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
import { SILENT_IO } from '../infra/io';
import { loadState, type LoadedState } from '../infra/state-store';
import { runAutoPush } from './auto-push';
import { bootstrapRepository, hasLocalRepository } from './bootstrap';
import { countAhead, countBehind, probeRemote, type RemoteProbe } from './check-remote';
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

interface PullRun {
  /** Files installed from the repository. */
  readonly files: number;
  /** The pull finished (possibly leaving conflicts recorded for `resolve`). */
  readonly completed: boolean;
}

/**
 * Applies the repository changes with the normal pull (same backups; conflicts are never
 * overwritten). A hook pulls silently; a manual sync shows what was installed, plugins included.
 */
async function pullRepository(context: CommandContext, files: number): Promise<PullRun> {
  const io = context.hook ? SILENT_IO : context.io;
  try {
    const code = await runPull({ ...context, io, assumeYes: false, dryRun: false });
    const completed = code === ExitCode.Ok || code === ExitCode.Conflicts;
    return { files: completed ? files : 0, completed };
  } catch (error) {
    if (!context.hook) context.io.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return { files: 0, completed: false };
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

/** What a hook says after trying the first-run setup; never throws. */
async function hookFirstRun(context: CommandContext, input: HookInput): Promise<void> {
  const now = context.now();
  const interval = intervalFrom(context.env.AGENT_SYNC_CHECK_INTERVAL_MINUTES);
  let cache = await loadCheckCache(context.dataHome);
  if (input.event !== CheckEvent.SessionStart && !isRemoteCheckDue(cache, now, interval)) return;
  const before = cache;
  cache = withRemoteCheck(cache, now);

  let message: string;
  try {
    const code = await bootstrapRepository({ ...context, io: SILENT_IO, dryRun: false }, false);
    if (code === ExitCode.Ok) message = 'sync-ai: repository cloned and your configuration installed.';
    else if (code === ExitCode.Conflicts) message = 'sync-ai: repository cloned; local files differ from it. Run /sync-ai:resolve.';
    else message = `sync-ai: first-run setup did not finish (exit ${code}). Run /sync-ai:sync.`;
  } catch (error) {
    message = `sync-ai: ${error instanceof Error ? error.message : String(error)}`;
  }
  cache = announce(context, input, cache, { user: message, claude: undefined, signature: 'first-run' });
  if (cache !== before) await saveCheckCache(context.dataHome, cache);
}

/** A manual `sync` on a device without a local clone: sets it up, creating the repository if needed. */
async function manualFirstRun(context: CommandContext): Promise<void> {
  try {
    await bootstrapRepository(context, true);
  } catch (error) {
    context.io.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function check(context: CommandContext, mode: CheckMode): Promise<void> {
  const { agent, dataHome, repoGit } = context;
  const manual = !context.hook;
  /** A `sync` the user ran: it applies what is safe, while a manual `check` only informs. */
  const manualSync = manual && mode === 'sync';
  const input = manual ? manualInput() : parseHookInput(await context.readStdin());
  if (!(await hasLocalRepository(context))) {
    if (manual) await manualFirstRun(context);
    else await hookFirstRun(context, input);
    return;
  }

  const probeDeadline = startDeadline(CHECK_BUDGET_MS);
  const overallDeadline = startDeadline(OVERALL_BUDGET_MS);
  const now = context.now();
  let state = await loadState(dataHome);
  const baselineOf = (loaded: LoadedState): boolean =>
    !loaded.invalid && Object.keys(basesOf(loaded.state, agent.name)).length > 0;
  let hasBaseline = baselineOf(state);
  // Without a baseline (a clone whose first install never finished) a hook only looks at the
  // repository when a chat starts, the one moment it may install it.
  const eager = manual || input.event === CheckEvent.SessionStart;
  const compares = hasBaseline || (eager && !state.invalid);
  let cache = await loadCheckCache(dataHome);
  const before = cache;

  const branch = (await repoGit.must(['symbolic-ref', '--short', 'HEAD'])).trim();
  const interval = intervalFrom(context.env.AGENT_SYNC_CHECK_INTERVAL_MINUTES);
  const remoteDue = compares && (eager || isRemoteCheckDue(cache, now, interval));
  let remoteProbe: RemoteProbe | undefined;
  if (remoteDue) {
    // The outcome only matters through the refs it updates; an unreachable remote is not an error.
    remoteProbe = await probeRemote(repoGit, branch, probeDeadline);
    cache = withRemoteCheck(cache, now);
  }

  let behind = await countBehind(repoGit, branch);
  let findings = compares ? await compare(context, state.state, behind > 0 ? `origin/${branch}` : 'HEAD') : NO_FINDINGS;
  const factsOf = (): CheckFacts => ({
    event: input.event,
    manual: manualSync,
    hasBaseline,
    stateReadable: !state.invalid,
    behind,
    toPush: findings.pushFiles.length,
    deletions: findings.deletions,
    toPull: findings.toPull,
    conflicts: findings.conflicts,
  });

  let pulled = 0;
  if (shouldAutoPull(factsOf()) && !context.dryRun) {
    const ran = await pullRepository(context, findings.toPull);
    pulled = ran.files;
    if (ran.completed) {
      // The pull moved the clone and recorded new bases: look again before deciding about a push.
      state = await loadState(dataHome);
      hasBaseline = baselineOf(state);
      behind = await countBehind(repoGit, branch);
      findings = await compare(context, state.state, 'HEAD');
    }
  }

  let autoPush: AutoPushOutcome = AUTO_PUSH_OFF;
  let pushFailed = false;
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
    pushFailed = run.failed;
    if (run.failed && !context.dryRun) cache = withAutoPushFailure(cache, now);
    if (autoPush.kind === 'pushed') findings = await compare(context, (await loadState(dataHome)).state, 'HEAD');
  }

  const report = buildReport(factsOf(), { pulled, dryRun: context.dryRun, autoPush });

  if (context.hook && (remoteDue || pulled > 0 || autoPush.kind === 'pushed' || pushFailed)) {
    const result = report?.user ?? (findings.pushFiles.length > 0
      ? `sync-ai: ${findings.pushFiles.length} local ${findings.pushFiles.length === 1 ? 'change' : 'changes'} waiting for automatic push.`
      : 'sync-ai: in sync.');
    const user = remoteProbe === 'unreachable'
      ? `sync-ai: remote unavailable; remote synchronization could not be verified. ${report?.user ?? ''}`.trim()
      : pushFailed ? `${result} Automatic push failed; will retry later.` : result;
    context.io.info(formatHookOutput(input, {
      user,
      claude: report?.claude,
      signature: report?.signature ?? 'completed',
    }));
    if (report && !context.dryRun) cache = withAnnouncement(cache, input.sessionId, report.signature, now);
  } else if (report) cache = announce(context, input, cache, report);
  else if (manual && !context.quiet) context.io.info('sync-ai: in sync.');

  if (!context.dryRun && cache !== before) await saveCheckCache(dataHome, cache);
}

/** `sync` applies what is safe (pull, first install, automatic push); `check` only does so from a hook. */
type CheckMode = 'sync' | 'check';

/** Tells whether this device is out of sync. Failures are reported without blocking the session. */
export async function runCheck(context: CommandContext, mode: CheckMode = 'check'): Promise<ExitCode> {
  if (context.env.AGENT_SYNC_CHECK === '0') return ExitCode.Ok;
  let reported = false;
  try {
    await check({ ...context, io: { ...context.io, info: (message) => {
      reported = true;
      context.io.info(message);
    } } }, mode);
  } catch {
    if (context.hook && !reported) context.io.info(JSON.stringify({ systemMessage: 'sync-ai: automatic synchronization check failed; run sync-ai status to inspect.' }));
  }
  return ExitCode.Ok;
}

/** The safe automatic sync flow the user runs by hand (`/sync-ai:sync`). */
export function runSync(context: CommandContext): Promise<ExitCode> {
  return runCheck(context, 'sync');
}
