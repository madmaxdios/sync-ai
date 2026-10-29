import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_MINUTES,
  emptyCache,
  intervalFrom,
  isRemoteCheckDue,
  parseCache,
  serializeCache,
  shouldAnnounce,
  withAnnouncement,
  withRemoteCheck,
} from '../../src/domain/check-cache';

const t0 = new Date('2026-10-29T10:00:00Z');
const minutesAfter = (minutes: number): Date => new Date(t0.getTime() + minutes * 60_000);

describe('remote check throttling', () => {
  it('is due when the remote was never checked', () => {
    expect(isRemoteCheckDue(emptyCache(), t0, 10)).toBe(true);
  });

  it('is not due inside the interval and is due after it', () => {
    const cache = withRemoteCheck(emptyCache(), t0);

    expect(isRemoteCheckDue(cache, minutesAfter(9), 10)).toBe(false);
    expect(isRemoteCheckDue(cache, minutesAfter(10), 10)).toBe(true);
  });

  it('is always due with an interval of zero', () => {
    expect(isRemoteCheckDue(withRemoteCheck(emptyCache(), t0), t0, 0)).toBe(true);
  });
});

describe('intervalFrom', () => {
  it.each([
    [undefined, DEFAULT_INTERVAL_MINUTES],
    ['', DEFAULT_INTERVAL_MINUTES],
    ['5', 5],
    ['0', 0],
    ['2.5', 2.5],
    ['soon', DEFAULT_INTERVAL_MINUTES],
    ['-3', DEFAULT_INTERVAL_MINUTES],
  ])('reads %j as %j', (value, expected) => {
    expect(intervalFrom(value)).toBe(expected);
  });
});

describe('message deduplication', () => {
  it('announces a new situation and then stays quiet for the same one', () => {
    const cache = withAnnouncement(emptyCache(), 's1', 'push1', t0);

    expect(shouldAnnounce(emptyCache(), 's1', 'push1', t0)).toBe(true);
    expect(shouldAnnounce(cache, 's1', 'push1', minutesAfter(5))).toBe(false);
  });

  it('announces again when the situation changes, after 30 minutes, or in another session', () => {
    const cache = withAnnouncement(emptyCache(), 's1', 'push1', t0);

    expect(shouldAnnounce(cache, 's1', 'push2', minutesAfter(1))).toBe(true);
    expect(shouldAnnounce(cache, 's1', 'push1', minutesAfter(30))).toBe(true);
    expect(shouldAnnounce(cache, 's2', 'push1', minutesAfter(1))).toBe(true);
  });

  it('remembers only the 20 most recent sessions', () => {
    let cache = emptyCache();
    for (let index = 0; index < 25; index += 1) {
      cache = withAnnouncement(cache, `s${index}`, 'x', minutesAfter(index));
    }

    expect(Object.keys(cache.announced)).toHaveLength(20);
    expect(cache.announced['s24']).toBeDefined();
    expect(cache.announced['s0']).toBeUndefined();
  });
});

describe('cache file', () => {
  it('round-trips and ignores garbage', () => {
    const cache = withAnnouncement(withRemoteCheck(emptyCache(), t0), 's1', 'push1', t0);

    expect(parseCache(serializeCache(cache))).toEqual(cache);
    expect(parseCache('not json')).toBeUndefined();
    expect(parseCache('{"version":2}')).toBeUndefined();
  });
});
