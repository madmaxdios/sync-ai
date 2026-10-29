export const DEFAULT_QUIET_MINUTES = 5;
export const DEFAULT_MAX_FILES = 20;

/** Reads a non-negative number from an environment value, falling back to the default. */
export function numberFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface PublishFile {
  readonly rel: string;
  /** Minutes since the file was last modified. */
  readonly ageMinutes: number;
}

export interface AutoPushFacts {
  readonly enabled: boolean;
  readonly hasBaseline: boolean;
  readonly conflicts: number;
  /** Repository changes this device does not have yet (it must pull before it can push). */
  readonly toPull: number;
  readonly behind: number;
  /** Commits in the clone that the remote does not have. */
  readonly ahead: number;
  /** New and changed files of the opt-in list: what would be published. */
  readonly files: readonly PublishFile[];
  readonly quietMinutes: number;
  readonly maxFiles: number;
  /** A recent automatic push failed, so the remote is not tried again yet. */
  readonly throttled: boolean;
}

export type AutoPushSkip = 'disabled' | 'no-baseline' | 'conflicts' | 'repository-ahead' | 'nothing' | 'throttled';

export type AutoPushDecision =
  | { readonly action: 'push' }
  /** Some file was edited too recently: a later check pushes it. */
  | { readonly action: 'wait' }
  | { readonly action: 'too-many'; readonly count: number; readonly max: number }
  | { readonly action: 'skip'; readonly reason: AutoPushSkip };

const skip = (reason: AutoPushSkip): AutoPushDecision => ({ action: 'skip', reason });

/** The rules of the automatic push, in the order they are checked. Deletions never take part. */
export function decideAutoPush(facts: AutoPushFacts): AutoPushDecision {
  if (!facts.enabled) return skip('disabled');
  if (!facts.hasBaseline) return skip('no-baseline');
  if (facts.conflicts > 0) return skip('conflicts');
  if (facts.toPull > 0 || facts.behind > 0) return skip('repository-ahead');
  if (facts.files.length === 0 && facts.ahead === 0) return skip('nothing');
  if (facts.throttled) return skip('throttled');
  if (facts.files.length > facts.maxFiles) return { action: 'too-many', count: facts.files.length, max: facts.maxFiles };
  if (facts.files.some((file) => file.ageMinutes < facts.quietMinutes)) return { action: 'wait' };
  return { action: 'push' };
}

/** What the automatic push did, as far as the report is concerned. */
export type AutoPushOutcome =
  /** Not applicable, disabled or failed: the plain "not pushed" notice applies. */
  | { readonly kind: 'off' }
  /** Edits are too recent: it will push by itself, so say nothing. */
  | { readonly kind: 'waiting' }
  | { readonly kind: 'pushed'; readonly files: number; readonly commit: string }
  | { readonly kind: 'would-push'; readonly files: number }
  | { readonly kind: 'blocked'; readonly files: number; readonly locations: string }
  | { readonly kind: 'too-many'; readonly count: number; readonly max: number };
