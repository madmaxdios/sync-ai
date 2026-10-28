import { FileState } from './file-state';
import { sameContent } from './line-endings';

export interface FileVersions {
  /** The file in the agent's home, if it exists. */
  readonly local: Buffer | undefined;
  /** The file in the repository clone, if it exists. */
  readonly repo: Buffer | undefined;
  /** The version that was last in sync on this device, if known. */
  readonly base: Buffer | undefined;
}

function same(a: Buffer | undefined, b: Buffer | undefined): boolean {
  return a !== undefined && b !== undefined && sameContent(a, b);
}

function classifyBothPresent(local: Buffer, repo: Buffer, base: Buffer | undefined): FileState {
  if (sameContent(local, repo)) return FileState.InSync;
  if (base === undefined) return FileState.Conflict;
  if (sameContent(local, base)) return FileState.RepoChanged;
  if (sameContent(repo, base)) return FileState.LocalChanged;
  return FileState.Conflict;
}

/**
 * Three-way classification of one file (L = local, R = repository, B = base):
 *
 *   L R B
 *   = = ?   in-sync       (L equals R)
 *   L R -   conflict      (they differ and nothing says who moved: first device)
 *   = ≠ B   repo-changed  (L equals B)
 *   ≠ = B   local-changed (R equals B)
 *   ≠ ≠ B   conflict      (both moved)
 *   L - -   new-local
 *   L - =   repo-deleted  (L equals B)
 *   L - ≠   conflict      (edited locally, deleted in the repository)
 *   - R -   new-repo
 *   - R =   local-deleted (R equals B)
 *   - R ≠   conflict      (deleted locally, edited in the repository)
 *   - - B   gone
 */
export function classifyFile({ local, repo, base }: FileVersions): FileState {
  if (local !== undefined && repo !== undefined) return classifyBothPresent(local, repo, base);

  if (local !== undefined) {
    if (base === undefined) return FileState.NewLocal;
    return same(local, base) ? FileState.RepoDeleted : FileState.Conflict;
  }

  if (repo !== undefined) {
    if (base === undefined) return FileState.NewRepo;
    return same(repo, base) ? FileState.LocalDeleted : FileState.Conflict;
  }

  return FileState.Gone;
}
