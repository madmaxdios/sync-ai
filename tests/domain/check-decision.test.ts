import { describe, expect, it } from 'vitest';
import { buildReport, shouldAutoPull, type CheckFacts, type CheckOutcome } from '../../src/domain/check-decision';
import { CheckEvent } from '../../src/domain/check-event';

const inSync: CheckFacts = {
  event: CheckEvent.SessionStart,
  manual: false,
  hasBaseline: true,
  stateReadable: true,
  toPush: 0,
  deletions: 0,
  toPull: 0,
  conflicts: 0,
  behind: 0,
};
const apply: CheckOutcome = { pulled: 0, dryRun: false, autoPush: { kind: 'off' } };

describe('shouldAutoPull', () => {
  it('pulls at the start of a chat when there is a baseline, no conflicts and something to apply', () => {
    expect(shouldAutoPull({ ...inSync, toPull: 2, behind: 1 })).toBe(true);
  });

  it.each([
    ['a prompt is sent', { event: CheckEvent.UserPromptSubmit, toPull: 2 }],
    ['another event happens', { event: CheckEvent.Other, toPull: 2 }],
    ['a hook finds a conflict', { conflicts: 1, toPull: 2 }],
    ['there is nothing to apply', { toPull: 0, behind: 3 }],
    ['the state file is unreadable', { hasBaseline: false, stateReadable: false, toPull: 2 }],
    ['a manual sync finds an unreadable state file', { manual: true, hasBaseline: false, stateReadable: false, toPull: 2 }],
    ['a prompt is sent on a device without a baseline', { event: CheckEvent.UserPromptSubmit, hasBaseline: false, toPull: 2 }],
  ])('never pulls when %s', (_name, change) => {
    expect(shouldAutoPull({ ...inSync, ...change })).toBe(false);
  });

  it('does not depend on local changes to push', () => {
    expect(shouldAutoPull({ ...inSync, toPull: 1, toPush: 4 })).toBe(true);
  });

  it.each([
    ['at the start of a chat', {}],
    ['on a manual sync', { manual: true, event: CheckEvent.Other }],
  ])('installs the repository on a device without a baseline %s, even with nothing new', (_name, change) => {
    expect(shouldAutoPull({ ...inSync, ...change, hasBaseline: false, toPull: 0 })).toBe(true);
    expect(shouldAutoPull({ ...inSync, ...change, hasBaseline: false, toPull: 3 })).toBe(true);
  });

  it('pulls on a manual sync with something to apply, even when a conflict must be kept', () => {
    const manual = { ...inSync, manual: true, event: CheckEvent.Other };

    expect(shouldAutoPull({ ...manual, toPull: 2 })).toBe(true);
    expect(shouldAutoPull({ ...manual, toPull: 2, conflicts: 1 })).toBe(true);
    expect(shouldAutoPull({ ...manual, toPull: 0 })).toBe(false);
  });

  it('keeps a device without a baseline away from a conflicting pull in a hook', () => {
    expect(shouldAutoPull({ ...inSync, hasBaseline: false, toPull: 3, conflicts: 1 })).toBe(false);
  });
});

describe('buildReport', () => {
  it('says nothing when everything is in sync', () => {
    expect(buildReport(inSync, apply)).toBeUndefined();
    expect(buildReport({ ...inSync, event: CheckEvent.UserPromptSubmit }, apply)).toBeUndefined();
  });

  it('asks to push when local changes are waiting, and tells the agent not to push on its own', () => {
    const report = buildReport({ ...inSync, toPush: 3 }, apply);

    expect(report?.user).toBe('sync-ai: 3 local changes not pushed (run /sync-ai:sync)');
    expect(report?.claude).toContain('offer /sync-ai:sync');
    expect(report?.claude).toContain('never push without their confirmation');
  });

  it('uses the singular for one change', () => {
    expect(buildReport({ ...inSync, toPush: 1 }, apply)?.user).toContain('1 local change not pushed');
  });

  it('only informs about repository changes when they were not pulled', () => {
    const report = buildReport({ ...inSync, event: CheckEvent.UserPromptSubmit, toPull: 2, behind: 2 }, apply);

    expect(report?.user).toBe('sync-ai: the repository has 2 file changes (2 newer commits) (run /sync-ai:sync)');
    expect(report?.claude).toContain('offer /sync-ai:sync');
  });

  it('reports a finished automatic pull without asking the agent to do anything', () => {
    const report = buildReport({ ...inSync, toPull: 2, behind: 1 }, { pulled: 2, dryRun: false, autoPush: { kind: 'off' } });

    expect(report?.user).toBe('sync-ai: pulled 2 files from the repository');
    expect(report?.claude).toBeUndefined();
  });

  it('points to resolve when files changed on both sides', () => {
    const report = buildReport({ ...inSync, conflicts: 2, toPull: 3 }, apply);

    expect(report?.user).toContain('2 conflicts, run /sync-ai:resolve');
    expect(report?.claude).toContain('do not overwrite them');
  });

  it('joins several findings in one line', () => {
    const report = buildReport({ ...inSync, toPull: 1, toPush: 2, event: CheckEvent.UserPromptSubmit }, apply);

    expect(report?.user.split('\n')).toHaveLength(1);
    expect(report?.user).toContain('(run /sync-ai:sync); 2 local changes not pushed');
  });

  it('reports an unfinished first install at the start of a chat and points to sync', () => {
    const noBaseline = { ...inSync, hasBaseline: false, toPull: 3, conflicts: 1 };
    const report = buildReport(noBaseline, apply);

    expect(report?.user).toBe(
      'sync-ai: this device has not synced yet and 1 local file differs from the repository, so nothing was installed (run /sync-ai:sync)',
    );
    expect(report?.claude).toContain('Offer /sync-ai:sync');
    expect(buildReport({ ...noBaseline, event: CheckEvent.UserPromptSubmit }, apply)).toBeUndefined();
  });

  it('points to status, not sync, when the state file is unreadable', () => {
    const report = buildReport({ ...inSync, hasBaseline: false, stateReadable: false }, apply);

    expect(report?.user).toContain('cannot be read');
    expect(report?.user).toContain('/sync-ai:status');
  });

  it('says what a dry-run first install would do', () => {
    const report = buildReport(
      { ...inSync, manual: true, event: CheckEvent.Other, hasBaseline: false, toPull: 4 },
      { pulled: 0, dryRun: true, autoPush: { kind: 'off' } },
    );

    expect(report?.user).toBe('[dry-run] sync-ai: first sync on this device, would install 4 files from the repository');
  });

  it('marks a dry run and says what it would pull', () => {
    const report = buildReport({ ...inSync, toPull: 2 }, { pulled: 0, dryRun: true, autoPush: { kind: 'off' } });

    expect(report?.user).toBe('[dry-run] sync-ai: would pull 2 files from the repository');
  });

  it('gives a different signature when the situation changes', () => {
    const one = buildReport({ ...inSync, toPush: 1 }, apply)?.signature;
    const two = buildReport({ ...inSync, toPush: 2 }, apply)?.signature;

    expect(one).not.toBe(two);
    expect(buildReport({ ...inSync, toPush: 1 }, apply)?.signature).toBe(one);
  });
});
