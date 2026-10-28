import { FileState } from '../domain/file-state';
import { ConflictStore, type ConflictRecord } from '../infra/conflict-store';
import type { CommandContext } from './context';
import { entriesIn, type SyncPlan } from './sync-plan';

export function conflictStoreOf(context: CommandContext): ConflictStore {
  return new ConflictStore(context.dataHome, context.agent.name);
}

/**
 * Makes the conflicts area mirror the conflicts of `plan` (and only those): writes the
 * copies for current conflicts and drops the ones that are no longer in conflict.
 * `settled` lists conflicts that were already settled by this run. Returns the open conflicts.
 */
export async function recordConflicts(
  context: CommandContext,
  plan: SyncPlan,
  settled: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const store = conflictStoreOf(context);
  const previous = await store.load();
  const recordedAt = context.now().toISOString();

  const entries: Record<string, ConflictRecord> = {};
  const open = entriesIn(plan, FileState.Conflict).filter((entry) => !settled.has(entry.rel));
  // Nothing recorded and nothing to record: do not create the conflicts area at all.
  if (open.length === 0 && Object.keys(previous.entries).length === 0) return [];
  for (const entry of open) {
    if (!entry.versions) continue;
    entries[entry.rel] = await store.write(entry.rel, entry.versions, recordedAt);
  }
  for (const rel of Object.keys(previous.entries)) {
    if (!(rel in entries)) await store.remove(rel);
  }
  await store.save({ version: 1, entries });
  return open.map((entry) => entry.rel);
}
