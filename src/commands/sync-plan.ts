import fs from 'node:fs/promises';
import { classifyFile } from '../domain/classify-file';
import { FileState } from '../domain/file-state';
import { gitBlobId } from '../domain/git-blob';
import { basesOf, setBase, type SyncState } from '../domain/sync-state';
import { toNativePath } from '../infra/file-system';
import type { CommandContext } from './context';
import { listLocalFiles } from './local-tree';
import type { RepoSnapshot } from './repo-snapshot';

export interface PlanEntry {
  readonly rel: string;
  readonly state: FileState;
  /** Blob id of the repository version, when the repository has the file. */
  readonly repoBlob: string | undefined;
  /** Contents needed to explain a conflict; only loaded for conflicting files. */
  readonly versions: ConflictVersions | undefined;
}

export interface ConflictVersions {
  readonly local: Buffer | undefined;
  readonly repo: Buffer | undefined;
  readonly base: Buffer | undefined;
}

export interface SyncPlan {
  readonly entries: readonly PlanEntry[];
  readonly snapshot: RepoSnapshot;
}

export function entriesIn(plan: SyncPlan, ...states: readonly FileState[]): PlanEntry[] {
  return plan.entries.filter((entry) => states.includes(entry.state));
}

async function readLocal(context: CommandContext, rel: string): Promise<Buffer> {
  return fs.readFile(toNativePath(context.agent.home, rel));
}

/**
 * Classifies every synced path by comparing the local file, the repository snapshot and the
 * base recorded at the last sync. Contents are only read from git for files that differ.
 */
export async function buildPlan(
  context: CommandContext,
  snapshot: RepoSnapshot,
  state: SyncState,
): Promise<SyncPlan> {
  const bases = basesOf(state, context.agent.name);
  const localFiles = new Set(await listLocalFiles(context));
  const paths = new Set([...localFiles, ...snapshot.blobs.keys(), ...Object.keys(bases)]);

  const entries: PlanEntry[] = [];
  for (const rel of [...paths].sort()) {
    const local = localFiles.has(rel) ? await readLocal(context, rel) : undefined;
    const repoBlob = snapshot.blobs.get(rel);
    if (local && repoBlob && gitBlobId(local) === repoBlob) {
      entries.push({ rel, state: FileState.InSync, repoBlob, versions: undefined });
      continue;
    }

    const repo = repoBlob ? await snapshot.read(repoBlob) : undefined;
    const baseBlob = bases[rel];
    const base = baseBlob ? await context.repoGit.blob(baseBlob) : undefined;
    const fileState = classifyFile({ local, repo, base });
    const versions = fileState === FileState.Conflict ? { local, repo, base } : undefined;
    entries.push({ rel, state: fileState, repoBlob, versions });
  }
  return { entries, snapshot };
}

/** Records the repository version as the new base of every path in sync (and drops stale ones). */
export function recordInSyncBases(
  state: SyncState,
  agent: string,
  plan: SyncPlan,
  extra: readonly PlanEntry[] = [],
): SyncState {
  let next = state;
  for (const entry of plan.entries) {
    if (entry.state === FileState.InSync) next = setBase(next, agent, entry.rel, entry.repoBlob);
    if (entry.state === FileState.Gone) next = setBase(next, agent, entry.rel, undefined);
  }
  for (const entry of extra) next = setBase(next, agent, entry.rel, entry.repoBlob);
  return next;
}
