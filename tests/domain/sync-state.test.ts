import { describe, expect, it } from 'vitest';
import { emptyState, parseState, serializeState, setBase, basesOf } from '../../src/domain/sync-state';

describe('sync state', () => {
  it('starts empty', () => {
    expect(basesOf(emptyState(), 'claude')).toEqual({});
  });

  it('keeps bases per agent and path, without touching other agents', () => {
    let state = setBase(emptyState(), 'claude', 'CLAUDE.md', 'abc');
    state = setBase(state, 'codex', 'AGENTS.md', 'def');

    expect(basesOf(state, 'claude')).toEqual({ 'CLAUDE.md': 'abc' });
    expect(basesOf(state, 'codex')).toEqual({ 'AGENTS.md': 'def' });
  });

  it('removes a base when the blob is undefined', () => {
    const state = setBase(setBase(emptyState(), 'claude', 'a.md', 'abc'), 'claude', 'a.md', undefined);

    expect(basesOf(state, 'claude')).toEqual({});
  });

  it('round-trips through JSON', () => {
    const state = setBase(emptyState(), 'claude', 'a.md', 'abc');

    expect(parseState(serializeState(state))).toEqual(state);
  });

  it('rejects malformed content', () => {
    expect(parseState('{"version":2}')).toBeUndefined();
    expect(parseState('not json')).toBeUndefined();
    expect(parseState('{"version":1,"agents":{"claude":{"bases":{"a.md":42}}}}')).toBeUndefined();
  });
});
