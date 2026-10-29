import { describe, expect, it } from 'vitest';
import {
  effectiveItems,
  emptySelection,
  isSynced,
  itemOf,
  itemsOf,
  listItem,
  parseItemKind,
  parseItemName,
  unlistItem,
} from '../../src/domain/sync-items';

const OPT_IN = ['skills', 'commands', 'agents'];

describe('itemOf', () => {
  it('takes the first two segments of an opt-in path', () => {
    expect(itemOf('skills/git/SKILL.md', OPT_IN)).toBe('skills/git');
    expect(itemOf('skills/git/refs/a.md', OPT_IN)).toBe('skills/git');
    expect(itemOf('commands/deploy.md', OPT_IN)).toBe('commands/deploy.md');
  });

  it('has no item for paths outside the opt-in folders', () => {
    expect(itemOf('CLAUDE.md', OPT_IN)).toBeUndefined();
    expect(itemOf('settings.json', OPT_IN)).toBeUndefined();
    expect(itemOf('skills', OPT_IN)).toBeUndefined();
  });
});

describe('itemsOf', () => {
  it('deduplicates the items of several paths', () => {
    expect([...itemsOf(['skills/a/x.md', 'skills/a/y.md', 'CLAUDE.md', 'agents/b.md'], OPT_IN)].sort()).toEqual([
      'agents/b.md',
      'skills/a',
    ]);
  });
});

describe('parsing', () => {
  it('accepts a kind or its folder name', () => {
    expect(parseItemKind('skill')).toBe('skill');
    expect(parseItemKind('commands')).toBe('command');
    expect(parseItemKind('hook')).toBeUndefined();
    expect(parseItemKind(undefined)).toBeUndefined();
  });

  it('strips .md and rejects paths and odd names', () => {
    expect(parseItemName('command', 'deploy.md')).toBe('deploy');
    expect(parseItemName('skill', 'git')).toBe('git');
    expect(parseItemName('skill', '../x')).toBeUndefined();
    expect(parseItemName('skill', 'a/b')).toBeUndefined();
    expect(parseItemName('skill', undefined)).toBeUndefined();
  });
});

describe('selection', () => {
  it('lists and unlists, undoing the opposite', () => {
    const listed = listItem(emptySelection(), 'skills/a');
    expect(listed).toEqual({ listed: ['skills/a'], unlisted: [] });
    const stopped = unlistItem(listed, 'skills/a');
    expect(stopped.listed).toEqual([]);
    expect(stopped.unlisted).toEqual(['skills/a']);
    expect(listItem(stopped, 'skills/a').unlisted).toEqual([]);
  });

  it('adds the repository items and the already synced ones, minus the stopped ones', () => {
    const selection = { listed: ['skills/mine'], unlisted: ['skills/old'] };

    const effective = effectiveItems(selection, new Set(['skills/repo', 'skills/old']), new Set(['agents/gone.md']));

    expect([...effective].sort()).toEqual(['agents/gone.md', 'skills/mine', 'skills/repo']);
  });

  it('treats paths outside the opt-in folders as always synced', () => {
    expect(isSynced('CLAUDE.md', OPT_IN, new Set())).toBe(true);
    expect(isSynced('skills/a/SKILL.md', OPT_IN, new Set())).toBe(false);
    expect(isSynced('skills/a/SKILL.md', OPT_IN, new Set(['skills/a']))).toBe(true);
  });
});
