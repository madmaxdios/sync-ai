import type { Deadline } from '../infra/deadline';
import type { Git } from '../infra/git';

const LS_REMOTE_TIMEOUT_MS = 3000;

export type RemoteProbe = 'unchanged' | 'fetched' | 'unreachable';

/**
 * Looks for new commits on the remote as cheaply as possible: one `git ls-remote` for the
 * branch, and a quiet `git fetch` only when its tip differs from what the clone already knows.
 * Every call is bounded by the deadline; any failure reads as `unreachable` and never throws.
 */
export async function probeRemote(git: Git, branch: string, deadline: Deadline): Promise<RemoteProbe> {
  const lsTimeout = Math.min(LS_REMOTE_TIMEOUT_MS, deadline.remaining());
  if (lsTimeout <= 0) return 'unreachable';

  const heads = await git.run(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { timeoutMs: lsTimeout });
  if (heads.code !== 0) return 'unreachable';
  const remoteTip = heads.stdout.trim().split(/\s+/)[0];
  if (!remoteTip) return 'unchanged';

  const known = await git.run(['rev-parse', '--verify', '-q', `origin/${branch}`]);
  if (known.code === 0 && known.stdout.trim() === remoteTip) return 'unchanged';

  const fetchTimeout = deadline.remaining();
  if (fetchTimeout <= 0) return 'unreachable';
  const fetched = await git.run(['fetch', '--quiet', 'origin'], { timeoutMs: fetchTimeout });
  return fetched.code === 0 ? 'fetched' : 'unreachable';
}

/** Commits on `origin/<branch>` that the clone does not have, from refs already fetched (offline). */
export async function countBehind(git: Git, branch: string): Promise<number> {
  const remoteRef = `origin/${branch}`;
  if (!(await git.succeeds(['rev-parse', '--verify', '-q', remoteRef]))) return 0;
  const range = (await git.succeeds(['rev-parse', '--verify', '-q', 'HEAD'])) ? `HEAD..${remoteRef}` : remoteRef;
  const counted = await git.run(['rev-list', '--count', range]);
  return counted.code === 0 ? Number(counted.stdout.trim()) || 0 : 0;
}

/** Commits in the clone that `origin/<branch>` does not have yet, from refs already fetched (offline). */
export async function countAhead(git: Git, branch: string): Promise<number> {
  const remoteRef = `origin/${branch}`;
  if (!(await git.succeeds(['rev-parse', '--verify', '-q', remoteRef]))) return 0;
  if (!(await git.succeeds(['rev-parse', '--verify', '-q', 'HEAD']))) return 0;
  const counted = await git.run(['rev-list', '--count', `${remoteRef}..HEAD`]);
  return counted.code === 0 ? Number(counted.stdout.trim()) || 0 : 0;
}
