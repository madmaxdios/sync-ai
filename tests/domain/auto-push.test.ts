import { describe, expect, it } from 'vitest';
import { decideAutoPush, numberFrom, type AutoPushFacts } from '../../src/domain/auto-push';

const facts = (overrides: Partial<AutoPushFacts> = {}): AutoPushFacts => ({
  enabled: true,
  hasBaseline: true,
  conflicts: 0,
  toPull: 0,
  behind: 0,
  ahead: 0,
  files: [{ rel: 'skills/a/SKILL.md', ageMinutes: 10 }],
  quietMinutes: 5,
  maxFiles: 20,
  throttled: false,
  ...overrides,
});

describe('decideAutoPush', () => {
  it('pushes quiet files', () => {
    expect(decideAutoPush(facts())).toEqual({ action: 'push' });
  });

  it('waits while any file was edited less than the quiet time ago', () => {
    const files = [
      { rel: 'a', ageMinutes: 30 },
      { rel: 'b', ageMinutes: 4.9 },
    ];
    expect(decideAutoPush(facts({ files }))).toEqual({ action: 'wait' });
  });

  it('pushes exactly at the quiet time', () => {
    expect(decideAutoPush(facts({ files: [{ rel: 'a', ageMinutes: 5 }] }))).toEqual({ action: 'push' });
  });

  it('refuses more files than the maximum', () => {
    const files = Array.from({ length: 21 }, (_, index) => ({ rel: `commands/c${index}.md`, ageMinutes: 60 }));
    expect(decideAutoPush(facts({ files }))).toEqual({ action: 'too-many', count: 21, max: 20 });
  });

  it('accepts exactly the maximum', () => {
    const files = Array.from({ length: 20 }, (_, index) => ({ rel: `commands/c${index}.md`, ageMinutes: 60 }));
    expect(decideAutoPush(facts({ files })).action).toBe('push');
  });

  it.each([
    ['disabled', { enabled: false }],
    ['no-baseline', { hasBaseline: false }],
    ['conflicts', { conflicts: 1 }],
    ['repository-ahead', { toPull: 1 }],
    ['repository-ahead', { behind: 2 }],
    ['nothing', { files: [] }],
    ['throttled', { throttled: true }],
  ] as const)('skips with %s', (reason, overrides) => {
    expect(decideAutoPush(facts(overrides))).toEqual({ action: 'skip', reason });
  });

  it('pushes pending commits even with no new files', () => {
    expect(decideAutoPush(facts({ files: [], ahead: 1 }))).toEqual({ action: 'push' });
  });
});

describe('numberFrom', () => {
  it.each([
    [undefined, 5],
    ['', 5],
    ['abc', 5],
    ['-1', 5],
    ['0', 0],
    ['12', 12],
  ])('reads %j as %s', (value, expected) => {
    expect(numberFrom(value, 5)).toBe(expected);
  });
});
