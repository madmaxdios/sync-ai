import fs from 'node:fs/promises';
import {
  DEFAULT_MAX_FILES,
  DEFAULT_QUIET_MINUTES,
  decideAutoPush,
  numberFrom,
  type AutoPushOutcome,
  type PublishFile,
} from '../domain/auto-push';
import { isAutoPushThrottled, type CheckCache } from '../domain/check-cache';
import { CheckEvent } from '../domain/check-event';
import { ExitCode } from '../domain/exit-code';
import type { Deadline } from '../infra/deadline';
import { toNativePath } from '../infra/file-system';
import { SILENT_IO } from '../infra/io';
import type { CommandContext } from './context';
import { executePush } from './push';
import { describeLocations, filesWithFindings, scanFilesToPublish } from './scan-secrets';

const MINUTE = 60_000;
/** Pushing needs the network: it is not started with less than this left of the time budget. */
const MIN_BUDGET_MS = 2500;
const PER_CALL_TIMEOUT_MS = 4000;

export interface AutoPushInput {
  readonly event: CheckEvent;
  readonly hasBaseline: boolean;
  readonly conflicts: number;
  readonly toPull: number;
  readonly behind: number;
  /** Commits in the clone that the remote does not have yet. */
  readonly ahead: number;
  /** New and changed files of the opt-in list. */
  readonly pushFiles: readonly string[];
  readonly cache: CheckCache;
  /** Minutes before a failed automatic push is tried again. */
  readonly retryMinutes: number;
  readonly deadline: Deadline;
}

export interface AutoPushRun {
  readonly outcome: AutoPushOutcome;
  /** True when the push was attempted and failed (offline, rejected...): the cache throttles retries. */
  readonly failed: boolean;
}

const OFF: AutoPushRun = { outcome: { kind: 'off' }, failed: false };

async function ageOfFiles(context: CommandContext, rels: readonly string[]): Promise<PublishFile[]> {
  const now = context.now().getTime();
  const files: PublishFile[] = [];
  for (const rel of rels) {
    try {
      const { mtimeMs } = await fs.stat(toNativePath(context.agent.home, rel));
      files.push({ rel, ageMinutes: Math.max(0, (now - mtimeMs) / MINUTE) });
    } catch {
      files.push({ rel, ageMinutes: 0 });
    }
  }
  return files;
}

async function publish(context: CommandContext, input: AutoPushInput): Promise<AutoPushRun> {
  const timeout = Math.min(PER_CALL_TIMEOUT_MS, input.deadline.remaining());
  const bounded: CommandContext = {
    ...context,
    io: SILENT_IO,
    assumeYes: false,
    dryRun: false,
    repoGit: context.repoGit.withTimeout(timeout),
  };
  try {
    const result = await executePush(bounded, { allowDeletions: false });
    if (result.code === ExitCode.SecretsDetected) {
      const { findings } = result;
      return { outcome: { kind: 'blocked', files: filesWithFindings(findings), locations: describeLocations(findings) }, failed: false };
    }
    if (result.code === ExitCode.Ok && result.commit !== undefined) {
      return { outcome: { kind: 'pushed', files: result.published.length, commit: result.commit }, failed: false };
    }
    return OFF;
  } catch {
    // Offline, rejected, out of time: the next check tries again after the retry interval.
    return { outcome: { kind: 'off' }, failed: true };
  }
}

/**
 * Publishes the listed local changes when it is safe (see decideAutoPush): never deletions, never
 * when the scanner finds anything, never before the files have been quiet for a while.
 */
export async function runAutoPush(context: CommandContext, input: AutoPushInput): Promise<AutoPushRun> {
  if (input.event !== CheckEvent.SessionStart && input.event !== CheckEvent.UserPromptSubmit) return OFF;

  const { env } = context;
  const files = await ageOfFiles(context, input.pushFiles);
  const decision = decideAutoPush({
    enabled: env.AGENT_SYNC_AUTO_PUSH !== '0',
    hasBaseline: input.hasBaseline,
    conflicts: input.conflicts,
    toPull: input.toPull,
    behind: input.behind,
    ahead: input.ahead,
    files,
    quietMinutes: numberFrom(env.AGENT_SYNC_AUTO_PUSH_QUIET_MINUTES, DEFAULT_QUIET_MINUTES),
    maxFiles: Math.max(1, Math.floor(numberFrom(env.AGENT_SYNC_AUTO_PUSH_MAX_FILES, DEFAULT_MAX_FILES))),
    throttled: isAutoPushThrottled(input.cache, context.now(), input.retryMinutes),
  });

  switch (decision.action) {
    case 'skip':
      // Nothing to publish is not the same as "not applicable": only deletions may be pending.
      return decision.reason === 'nothing' ? { outcome: { kind: 'waiting' }, failed: false } : OFF;
    case 'wait':
      return { outcome: { kind: 'waiting' }, failed: false };
    case 'too-many':
      return { outcome: { kind: 'too-many', count: decision.count, max: decision.max }, failed: false };
    case 'push':
      break;
  }

  // The scan is local and fast, so a blocked push costs no network on every prompt.
  const findings = await scanFilesToPublish(context, input.pushFiles);
  if (findings.length > 0) {
    return { outcome: { kind: 'blocked', files: filesWithFindings(findings), locations: describeLocations(findings) }, failed: false };
  }
  if (context.dryRun) return { outcome: { kind: 'would-push', files: files.length }, failed: false };
  if (input.deadline.remaining() < MIN_BUDGET_MS) return OFF;
  return publish(context, input);
}
