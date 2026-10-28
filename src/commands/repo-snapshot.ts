import { createDenyMatcher } from '../domain/path-filter';
import type { CommandContext } from './context';

/** The agent's files in the repository at one git ref, read straight from git objects. */
export interface RepoSnapshot {
  readonly ref: string;
  /** Agent-relative path -> git blob id, limited to allowlisted, non-denied files. */
  readonly blobs: ReadonlyMap<string, string>;
  /** Paths stored with the executable bit. */
  readonly executable: ReadonlySet<string>;
  /** Raw content of a blob, or undefined when the object is missing. */
  read(blobId: string): Promise<Buffer | undefined>;
}

function isAllowed(rel: string, allow: readonly string[]): boolean {
  return allow.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

export interface TreeEntry {
  readonly sha: string;
  readonly executable: boolean;
}

/** Parses `git ls-tree -r -z` output: `<mode> <type> <sha>\t<path>\0` per entry. */
export function parseTree(output: string, prefix: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const line of output.split('\0')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    if (type !== 'blob' || !sha || !path.startsWith(prefix)) continue;
    entries.set(path.slice(prefix.length), { sha, executable: mode === '100755' });
  }
  return entries;
}

export async function readRepoSnapshot(
  context: CommandContext,
  ref: string,
): Promise<RepoSnapshot> {
  const { agent, repoGit } = context;
  const read = (blobId: string): Promise<Buffer | undefined> => repoGit.blob(blobId);
  const hasRef = await repoGit.succeeds(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  if (!hasRef) return { ref, blobs: new Map(), executable: new Set(), read };

  const prefix = `${agent.name}/`;
  const output = await repoGit.must(['ls-tree', '-r', '-z', ref, '--', prefix]);
  const isDenied = createDenyMatcher(agent.deny);
  const blobs = new Map<string, string>();
  const executable = new Set<string>();
  for (const [rel, entry] of parseTree(output, prefix)) {
    if (!isAllowed(rel, agent.allow) || isDenied(rel)) continue;
    blobs.set(rel, entry.sha);
    if (entry.executable) executable.add(rel);
  }
  return { ref, blobs, executable, read };
}
