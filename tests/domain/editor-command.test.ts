import { describe, expect, it } from 'vitest';
import { editorArguments, isSafeForCmd } from '../../src/domain/editor-command';

const files = { local: '/c/x.local', repo: '/c/x.repo', base: '/c/x.base', result: '/home/.claude/x.md' };

describe('editorArguments', () => {
  it('builds the VS Code three-way merge invocation with the real file as the result', () => {
    expect(editorArguments('code', files)).toEqual([
      '--wait',
      '--merge',
      '/c/x.local',
      '/c/x.repo',
      '/c/x.base',
      '/home/.claude/x.md',
    ]);
  });

  it('opens the real file, the ancestor and the repository version in vimdiff', () => {
    expect(editorArguments('vimdiff', files)).toEqual(['/home/.claude/x.md', '/c/x.base', '/c/x.repo']);
  });
});

describe('isSafeForCmd', () => {
  it('accepts ordinary Windows paths, including spaces', () => {
    expect(isSafeForCmd(['--wait', 'C:\\Users\\Jane Doe\\AppData\\x.md'])).toBe(true);
  });

  it.each(['a&b.md', 'a|b.md', 'a>b.md', '%PATH%.md', 'a^b.md', 'a"b.md'])('rejects %s', (arg) => {
    expect(isSafeForCmd([arg])).toBe(false);
  });
});
