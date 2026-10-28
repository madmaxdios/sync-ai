import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gitBlobId } from '../../src/domain/git-blob';

describe('gitBlobId', () => {
  it.each(['', 'hello\n', 'line1\r\nline2\r\n'])('matches `git hash-object` for %j', (text) => {
    const expected = execFileSync('git', ['hash-object', '--stdin'], { input: text }).toString().trim();

    expect(gitBlobId(Buffer.from(text))).toBe(expected);
  });

  it('matches git for binary content', () => {
    const content = Buffer.from([0, 1, 2, 255, 13, 10]);
    const expected = execFileSync('git', ['hash-object', '--stdin'], { input: content }).toString().trim();

    expect(gitBlobId(content)).toBe(expected);
  });
});
