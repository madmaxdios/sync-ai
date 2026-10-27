import { describe, expect, it } from 'vitest';
import { createDenyMatcher, globToRegExp } from '../../src/domain/path-filter';

describe('globToRegExp', () => {
  it('matches the whole name, with * and ? wildcards', () => {
    const glob = globToRegExp('*.backup-*');

    expect(glob.test('SKILL.md.backup-20200101-000000')).toBe(true);
    expect(glob.test('backup-notes.md')).toBe(false);
    expect(globToRegExp('file?.md').test('file1.md')).toBe(true);
    expect(globToRegExp('file?.md').test('file12.md')).toBe(false);
  });

  it('treats regular expression characters literally', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('(x)').test('(x)')).toBe(true);
  });
});

describe('createDenyMatcher', () => {
  const isDenied = createDenyMatcher(['settings.json', 'synced', '*.bak', '.git']);

  it.each([
    'settings.json',
    'skills/synced/SKILL.md',
    'skills/foo/notes.bak',
    'skills/foo/.git/config',
  ])('denies %s because one of its path components matches', (rel) => {
    expect(isDenied(rel)).toBe(true);
  });

  it.each(['CLAUDE.md', 'skills/foo/SKILL.md', 'skills/synced-notes/SKILL.md', 'commands/settings.json.md'])(
    'allows %s',
    (rel) => {
      expect(isDenied(rel)).toBe(false);
    },
  );
});
