import type { AutoPushOutcome } from './auto-push';
import { CheckEvent } from './check-event';

/** What the comparison between this device and the repository found. */
export interface CheckFacts {
  readonly event: CheckEvent;
  /** True for a `sync` the user ran by hand, false for the agent's hooks. */
  readonly manual: boolean;
  /** False when this device has never recorded a sync (no state): the next pull is its first install. */
  readonly hasBaseline: boolean;
  /** False when a state file exists but cannot be read: nothing is applied until it is fixed. */
  readonly stateReadable: boolean;
  /** Local files that the repository does not have yet (new or changed here). */
  readonly toPush: number;
  /** Local files that were deleted here and still exist in the repository. */
  readonly deletions: number;
  /** Repository files that this device does not have yet (new or changed there). */
  readonly toPull: number;
  /** Files changed on both sides. */
  readonly conflicts: number;
  /** Commits on the remote that the local clone does not have. */
  readonly behind: number;
}

export interface CheckOutcome {
  /** Files installed by the automatic pull (0 when none was done). */
  readonly pulled: number;
  readonly dryRun: boolean;
  /** What the automatic push did (`off` when it is disabled or does not apply). */
  readonly autoPush: AutoPushOutcome;
}

export interface CheckReport {
  /** One short line for the user. */
  readonly user: string;
  /** A factual sentence for the agent; only present when the user has something to decide. */
  readonly claude: string | undefined;
  /** Identifies the situation, so the same message is not repeated on every prompt. */
  readonly signature: string;
}

/**
 * Pulls happen on a manual `sync` and at the start of a chat, never when a prompt is sent.
 * A pull never overwrites a conflict; the hook still skips the whole pull when there is one,
 * while a manual `sync` installs the rest and records the conflicts for `resolve`.
 * Without a baseline the pull is the device's first install, which also records the files that
 * already match, so it runs even when nothing is new.
 */
export function shouldAutoPull(facts: CheckFacts): boolean {
  if (!facts.stateReadable) return false;
  const pending = facts.toPull > 0 || !facts.hasBaseline;
  if (facts.manual) return pending || facts.conflicts > 0;
  return facts.event === CheckEvent.SessionStart && facts.conflicts === 0 && pending;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function signatureOf(facts: CheckFacts, outcome: CheckOutcome): string {
  const { hasBaseline, toPush, deletions, toPull, conflicts, behind } = facts;
  const { kind } = outcome.autoPush;
  const pushed = outcome.autoPush.kind === 'pushed' ? outcome.autoPush.commit : '';
  return [
    hasBaseline ? 'baseline' : 'no-baseline',
    `push${toPush}`,
    `delete${deletions}`,
    `pull${toPull}`,
    `conflict${conflicts}`,
    `behind${behind}`,
    `pulled${outcome.pulled}`,
    `auto-${kind}`,
    pushed,
  ].join('|');
}

interface Lines {
  readonly user: string[];
  readonly claude: string[];
}

function describeConflicts(facts: CheckFacts, lines: Lines): void {
  if (facts.conflicts === 0) return;
  lines.user.push(`${plural(facts.conflicts, 'conflict')}, run /sync-ai:resolve`);
  lines.claude.push(
    `sync-ai: ${plural(facts.conflicts, 'file')} changed on both sides. Tell the user to run /sync-ai:resolve and do not overwrite them.`,
  );
}

function describePull(facts: CheckFacts, outcome: CheckOutcome, lines: Lines): void {
  if (outcome.pulled > 0) {
    lines.user.push(`pulled ${plural(outcome.pulled, 'file')} from the repository`);
  } else if (outcome.dryRun && facts.toPull > 0 && shouldAutoPull(facts)) {
    lines.user.push(`would pull ${plural(facts.toPull, 'file')} from the repository`);
  } else if (facts.toPull > 0) {
    const commits = facts.behind > 0 ? ` (${plural(facts.behind, 'newer commit')})` : '';
    lines.user.push(`the repository has ${plural(facts.toPull, 'file change')}${commits} (run /sync-ai:sync)`);
    lines.claude.push('sync-ai: the repository has newer changes than this device. Mention it to the user and offer /sync-ai:sync.');
  }
}

function describeDeletions(count: number, lines: Lines): void {
  if (count === 0) return;
  lines.user.push(`${plural(count, 'deletion')} pending, run /sync-ai:sync to confirm`);
  lines.claude.push(
    `sync-ai: ${plural(count, 'file')} deleted locally ${count === 1 ? 'is' : 'are'} still in the repository. Mention it and offer /sync-ai:sync, which asks the user to confirm deletions.`,
  );
}

function describePush(facts: CheckFacts, outcome: CheckOutcome, lines: Lines): void {
  const auto = outcome.autoPush;
  switch (auto.kind) {
    case 'off': {
      const changes = facts.toPush + facts.deletions;
      if (changes === 0) return;
      lines.user.push(`${plural(changes, 'local change')} not pushed (run /sync-ai:sync)`);
      lines.claude.push(
        `sync-ai: ${plural(changes, 'file')} changed locally and not pushed. Mention it to the user and offer /sync-ai:sync; never push without their confirmation.`,
      );
      return;
    }
    case 'waiting':
      describeDeletions(facts.deletions, lines);
      return;
    case 'pushed':
      lines.user.push(
        auto.files > 0
          ? `pushed ${plural(auto.files, 'file')} (commit ${auto.commit})`
          : `published the pending commits (commit ${auto.commit})`,
      );
      describeDeletions(facts.deletions, lines);
      return;
    case 'would-push':
      lines.user.push(`would push ${plural(auto.files, 'file')}`);
      describeDeletions(facts.deletions, lines);
      return;
    case 'blocked':
      lines.user.push(
        `auto-push skipped, ${plural(auto.files, 'file')} contain${auto.files === 1 ? 's' : ''} possible secrets or personal data ` +
          `(${auto.locations}); fix them or review with /sync-ai:sync`,
      );
      lines.claude.push(
        `sync-ai: auto-push was blocked because ${plural(auto.files, 'file')} may contain secrets, passwords or personal data (${auto.locations}). Tell the user to fix them or review with /sync-ai:sync; never print the matched content.`,
      );
      describeDeletions(facts.deletions, lines);
      return;
    case 'too-many':
      lines.user.push(`${auto.count} files changed, more than the auto-push limit of ${auto.max} (run /sync-ai:sync)`);
      lines.claude.push(
        `sync-ai: ${auto.count} files changed locally, more than the auto-push limit of ${auto.max}. Mention it and offer /sync-ai:sync; never push without the user's confirmation.`,
      );
      describeDeletions(facts.deletions, lines);
      return;
  }
}

function describeMissingBaseline(facts: CheckFacts, outcome: CheckOutcome, dryRun: string): CheckReport | undefined {
  if (!facts.manual && facts.event !== CheckEvent.SessionStart) return undefined;
  const signature = signatureOf(facts, outcome);
  if (!facts.stateReadable) {
    return {
      user: `${dryRun}sync-ai: the sync state file cannot be read, so nothing was installed (run /sync-ai:status)`,
      claude: 'sync-ai: the sync state file is unreadable, so nothing is applied. Suggest running /sync-ai:status.',
      signature,
    };
  }
  if (outcome.dryRun && shouldAutoPull(facts)) {
    return {
      user: `${dryRun}sync-ai: first sync on this device, would install ${plural(facts.toPull, 'file')} from the repository`,
      claude: undefined,
      signature,
    };
  }
  if (facts.toPull === 0 && facts.conflicts === 0) {
    return {
      user: `${dryRun}sync-ai: this device has not synced yet and the repository has nothing to install`,
      claude: undefined,
      signature,
    };
  }
  const differing = facts.conflicts > 0 ? ` and ${plural(facts.conflicts, 'local file')} ${facts.conflicts === 1 ? 'differs' : 'differ'} from the repository` : '';
  return {
    user: `${dryRun}sync-ai: this device has not synced yet${differing}, so nothing was installed (run /sync-ai:sync)`,
    claude:
      'sync-ai: the repository configuration is not installed on this device yet. Offer /sync-ai:sync, which installs it and never overwrites differing local files.',
    signature,
  };
}

/** Builds the message for the user (and for the agent when action is needed), or nothing when in sync. */
export function buildReport(facts: CheckFacts, outcome: CheckOutcome): CheckReport | undefined {
  const dryRun = outcome.dryRun ? '[dry-run] ' : '';

  // A successful first install records the baseline, so only an unfinished one reaches this branch.
  if (!facts.hasBaseline) return describeMissingBaseline(facts, outcome, dryRun);

  const lines: Lines = { user: [], claude: [] };
  describeConflicts(facts, lines);
  describePull(facts, outcome, lines);
  describePush(facts, outcome, lines);

  if (lines.user.length === 0) return undefined;
  return {
    user: `${dryRun}sync-ai: ${lines.user.join('; ')}`,
    claude: lines.claude.length > 0 ? lines.claude.join(' ') : undefined,
    signature: signatureOf(facts, outcome),
  };
}
