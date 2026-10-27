import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAffirmative } from '../../src/domain/answers';
import { sameContent } from '../../src/domain/line-endings';
import { describeRelation, formatStamp } from '../../src/domain/report';
import { diffTrees } from '../../src/domain/tree-differences';
import { resolveDataHome } from '../../src/infra/data-home';

describe('isAffirmative', () => {
  it.each(['s', 'S', 'si', 'Sí', 'y', 'YES', ' yes '])('accepts %j', (answer) => {
    expect(isAffirmative(answer)).toBe(true);
  });

  it.each(['', 'n', 'no', 'maybe', 'yess'])('rejects %j', (answer) => {
    expect(isAffirmative(answer)).toBe(false);
  });
});

describe('sameContent', () => {
  it('ignores CRLF vs LF in text files', () => {
    expect(sameContent(Buffer.from('a\r\nb\r\n'), Buffer.from('a\nb\n'))).toBe(true);
  });

  it('detects real differences', () => {
    expect(sameContent(Buffer.from('a\n'), Buffer.from('b\n'))).toBe(false);
  });

  it('compares binary files byte by byte', () => {
    expect(sameContent(Buffer.from([0, 13, 10]), Buffer.from([0, 10]))).toBe(false);
  });
});

describe('diffTrees', () => {
  it('splits paths into local-only, repo-only and common', () => {
    expect(diffTrees(['a', 'b'], ['b', 'c'])).toEqual({
      onlyLocal: ['a'],
      onlyRepo: ['c'],
      common: ['b'],
    });
  });
});

describe('describeRelation', () => {
  it.each([
    [0, 0, 'up to date'],
    [2, 0, '2 commit(s) to publish from the clone'],
    [0, 3, "3 new commit(s) on the remote (run 'pull')"],
    [1, 4, 'diverged (1 to publish, 4 new on the remote)'],
  ])('describes ahead=%i behind=%i', (ahead, behind, expected) => {
    expect(describeRelation(ahead, behind)).toBe(expected);
  });
});

describe('formatStamp', () => {
  it('formats local time as YYYYMMDD-HHMMSS', () => {
    expect(formatStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
});

describe('resolveDataHome', () => {
  it('prefers AGENT_SYNC_HOME', () => {
    expect(resolveDataHome({ AGENT_SYNC_HOME: '/data' }, '/home/u', 'linux')).toBe('/data');
  });

  it('defaults to ~/.local/share/agent-sync on Unix', () => {
    expect(resolveDataHome({}, '/home/u', 'linux')).toBe(
      path.join('/home/u', '.local', 'share', 'agent-sync'),
    );
  });

  it('uses LOCALAPPDATA on Windows, falling back to AppData/Local', () => {
    expect(resolveDataHome({ LOCALAPPDATA: 'C:\\L' }, 'C:\\u', 'win32')).toBe(
      path.join('C:\\L', 'agent-sync'),
    );
    expect(resolveDataHome({}, 'C:\\u', 'win32')).toBe(
      path.join('C:\\u', 'AppData', 'Local', 'agent-sync'),
    );
  });
});
