import type { AutoPushOutcome } from './auto-push';
import { CheckEvent } from './check-event';

/** What the comparison between this device and the repository found. */
export interface CheckFacts {
  readonly event: CheckEvent;
  /** False when this device has never recorded a sync (no state): nothing is auto-applied. */
  readonly hasBaseline: boolean;
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

/** Pulling is only automatic at the start of a chat, with a baseline and without conflicts. */
export function shouldAutoPull(facts: CheckFacts): boolean {
  return (
    facts.event === CheckEvent.SessionStart &&
    facts.hasBaseline &&
    facts.conflicts === 0 &&
    facts.toPull > 0
  );
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
  } else if (outcome.dryRun && shouldAutoPull(facts)) {
    lines.user.push(`would pull ${plural(facts.toPull, 'file')} from the repository`);
  } else if (facts.toPull > 0) {
    const commits = facts.behind > 0 ? ` (${plural(facts.behind, 'newer commit')})` : '';
    lines.user.push(`the repository has ${plural(facts.toPull, 'file change')}${commits} (run /sync-ai:pull)`);
    lines.claude.push('sync-ai: the repository has newer changes than this device. Mention it to the user and offer /sync-ai:pull.');
  }
}

function describeDeletions(count: number, lines: Lines): void {
  if (count === 0) return;
  lines.user.push(`${plural(count, 'deletion')} pending, run /sync-ai:push to confirm`);
  lines.claude.push(
    `sync-ai: ${plural(count, 'file')} deleted locally ${count === 1 ? 'is' : 'are'} still in the repository. Mention it and offer /sync-ai:push, which asks the user to confirm deletions.`,
  );
}

function describePush(facts: CheckFacts, outcome: CheckOutcome, lines: Lines): void {
  const auto = outcome.autoPush;
  switch (auto.kind) {
    case 'off': {
      const changes = facts.toPush + facts.deletions;
      if (changes === 0) return;
      lines.user.push(`${plural(changes, 'local change')} not pushed (run /sync-ai:push)`);
      lines.claude.push(
        `sync-ai: ${plural(changes, 'file')} changed locally and not pushed. Mention it to the user and offer /sync-ai:push; never push without their confirmation.`,
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
          `(${auto.locations}); fix them or review with /sync-ai:push`,
      );
      lines.claude.push(
        `sync-ai: auto-push was blocked because ${plural(auto.files, 'file')} may contain secrets, passwords or personal data (${auto.locations}). Tell the user to fix them or review with /sync-ai:push; never print the matched content.`,
      );
      describeDeletions(facts.deletions, lines);
      return;
    case 'too-many':
      lines.user.push(`${auto.count} files changed, more than the auto-push limit of ${auto.max} (run /sync-ai:push)`);
      lines.claude.push(
        `sync-ai: ${auto.count} files changed locally, more than the auto-push limit of ${auto.max}. Mention it and offer /sync-ai:push; never push without the user's confirmation.`,
      );
      describeDeletions(facts.deletions, lines);
      return;
  }
}

/** Builds the message for the user (and for the agent when action is needed), or nothing when in sync. */
export function buildReport(facts: CheckFacts, outcome: CheckOutcome): CheckReport | undefined {
  const dryRun = outcome.dryRun ? '[dry-run] ' : '';

  if (!facts.hasBaseline) {
    if (facts.event !== CheckEvent.SessionStart) return undefined;
    return {
      user: `${dryRun}sync-ai: this device has no sync baseline yet, so nothing is applied automatically (run /sync-ai:status)`,
      claude: 'sync-ai: this device has no sync baseline, so automatic pulls are off. Suggest running /sync-ai:status.',
      signature: signatureOf(facts, outcome),
    };
  }

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
