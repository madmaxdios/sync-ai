const REGEXP_SPECIALS = /[.+^${}()|[\]\\]/g;

/** Converts a glob made of `*` and `?` into an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(REGEXP_SPECIALS, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 's');
}

/**
 * Builds a predicate that is true when ANY path component of a `/` separated
 * relative path matches one of the deny globs.
 */
export function createDenyMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  const matchers = patterns.map(globToRegExp);
  return (relPath) =>
    relPath.split('/').some((part) => matchers.some((matcher) => matcher.test(part)));
}
