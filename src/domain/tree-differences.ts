export interface TreeDifferences {
  readonly onlyLocal: readonly string[];
  readonly onlyRepo: readonly string[];
  readonly common: readonly string[];
}

/** Both inputs are sorted lists of relative paths; outputs keep that order. */
export function diffTrees(local: readonly string[], repo: readonly string[]): TreeDifferences {
  const localSet = new Set(local);
  const repoSet = new Set(repo);
  return {
    onlyLocal: local.filter((rel) => !repoSet.has(rel)),
    onlyRepo: repo.filter((rel) => !localSet.has(rel)),
    common: local.filter((rel) => repoSet.has(rel)),
  };
}
