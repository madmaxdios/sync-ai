export enum FileState {
  InSync = 'in-sync',
  RepoChanged = 'repo-changed',
  LocalChanged = 'local-changed',
  Conflict = 'conflict',
  NewLocal = 'new-local',
  NewRepo = 'new-repo',
  /** Deleted in the repository while the local copy is untouched since the last sync. */
  RepoDeleted = 'repo-deleted',
  /** Deleted locally while the repository copy is untouched since the last sync. */
  LocalDeleted = 'local-deleted',
  /** Missing on both sides: only a stale base remains. */
  Gone = 'gone',
}
