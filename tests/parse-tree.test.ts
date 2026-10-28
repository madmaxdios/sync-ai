import { describe, expect, it } from 'vitest';
import { parseTree } from '../src/commands/repo-snapshot';

describe('parseTree', () => {
  const output = [
    '100644 blob aaa\tclaude/CLAUDE.md',
    '100755 blob bbb\tclaude/skills/x/run.sh',
    '160000 commit ccc\tclaude/vendor/sub',
    '100644 blob ddd\tcodex/AGENTS.md',
    '',
  ].join('\0');

  it('keeps only the blobs under the agent folder, relative to it, with their executable bit', () => {
    expect(parseTree(output, 'claude/')).toEqual(
      new Map([
        ['CLAUDE.md', { sha: 'aaa', executable: false }],
        ['skills/x/run.sh', { sha: 'bbb', executable: true }],
      ]),
    );
  });

  it('handles an empty listing', () => {
    expect(parseTree('', 'claude/')).toEqual(new Map());
  });
});
