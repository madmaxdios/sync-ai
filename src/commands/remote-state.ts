import { AppError } from '../domain/app-error';
import type { Git } from '../infra/git';

export type RemoteState =
  | { readonly status: 'unreachable'; readonly error: string }
  | { readonly status: 'empty'; readonly branch: string; readonly ahead: 0; readonly behind: 0 }
  | {
      readonly status: 'ready';
      readonly branch: string;
      readonly ahead: number;
      readonly behind: number;
    };

export type ReachableRemote = Exclude<RemoteState, { status: 'unreachable' }>;

/** Fetches origin and reports how the local clone relates to it. */
export async function refreshRemote(git: Git): Promise<RemoteState> {
  const branch = (await git.must(['symbolic-ref', '--short', 'HEAD'])).trim();

  const heads = await git.run(['ls-remote', '--heads', 'origin']);
  if (heads.code !== 0) {
    const error = [heads.stdout, heads.stderr].filter(Boolean).join('\n').trim();
    return { status: 'unreachable', error };
  }
  if (heads.stdout.trim() === '') return { status: 'empty', branch, ahead: 0, behind: 0 };

  await git.must(['fetch', '--quiet', 'origin']);
  const remoteRef = `origin/${branch}`;
  if (!(await git.succeeds(['rev-parse', '--verify', '-q', remoteRef]))) {
    throw new AppError(`the remote has no branch '${branch}', which your local clone uses`);
  }

  if (await git.succeeds(['rev-parse', '--verify', '-q', 'HEAD'])) {
    const counts = await git.must(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
    const [ahead = 0, behind = 0] = counts.trim().split(/\s+/).map(Number);
    return { status: 'ready', branch, ahead, behind };
  }
  const behind = Number((await git.must(['rev-list', '--count', remoteRef])).trim());
  return { status: 'ready', branch, ahead: 0, behind };
}

export function requireReachable(state: RemoteState): ReachableRemote {
  if (state.status === 'unreachable') {
    throw new AppError(`could not reach the remote: ${state.error}`);
  }
  return state;
}
