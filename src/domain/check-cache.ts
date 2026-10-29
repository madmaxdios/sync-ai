import { z } from 'zod';

const announcedSchema = z.object({ signature: z.string(), at: z.string() });

const cacheSchema = z.object({
  version: z.literal(1),
  /** When the remote was last contacted (or attempted), to throttle the network. */
  lastRemoteCheckAt: z.string().optional(),
  /** When an automatic push last failed, so the remote is not tried again on every prompt. */
  lastAutoPushFailureAt: z.string().optional(),
  /** The last message announced per chat session, to avoid repeating it on every prompt. */
  announced: z.record(z.string(), announcedSchema),
});

export type CheckCache = z.infer<typeof cacheSchema>;

export const DEFAULT_INTERVAL_MINUTES = 10;
export const REANNOUNCE_AFTER_MINUTES = 30;
const MAX_REMEMBERED_SESSIONS = 20;
const MINUTE = 60_000;

export function emptyCache(): CheckCache {
  return { version: 1, announced: {} };
}

/** Returns undefined when the content is not a valid cache file. */
export function parseCache(json: string): CheckCache | undefined {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function serializeCache(cache: CheckCache): string {
  return `${JSON.stringify(cache, null, 2)}\n`;
}

/** Reads the interval from `AGENT_SYNC_CHECK_INTERVAL_MINUTES`, falling back to the default. */
export function intervalFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_INTERVAL_MINUTES;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_INTERVAL_MINUTES;
}

function minutesSince(iso: string | undefined, now: Date): number {
  if (iso === undefined) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? Number.POSITIVE_INFINITY : (now.getTime() - then) / MINUTE;
}

export function isRemoteCheckDue(cache: CheckCache, now: Date, intervalMinutes: number): boolean {
  return minutesSince(cache.lastRemoteCheckAt, now) >= intervalMinutes;
}

/** A message is announced again when the situation changed or the last one is old. */
export function shouldAnnounce(cache: CheckCache, sessionId: string, signature: string, now: Date): boolean {
  const last = cache.announced[sessionId];
  if (last === undefined || last.signature !== signature) return true;
  return minutesSince(last.at, now) >= REANNOUNCE_AFTER_MINUTES;
}

/** True while the last failed automatic push is more recent than the interval. */
export function isAutoPushThrottled(cache: CheckCache, now: Date, intervalMinutes: number): boolean {
  return minutesSince(cache.lastAutoPushFailureAt, now) < intervalMinutes;
}

export function withAutoPushFailure(cache: CheckCache, now: Date): CheckCache {
  return { ...cache, lastAutoPushFailureAt: now.toISOString() };
}

export function withRemoteCheck(cache: CheckCache, now: Date): CheckCache {
  return { ...cache, lastRemoteCheckAt: now.toISOString() };
}

export function withAnnouncement(cache: CheckCache, sessionId: string, signature: string, now: Date): CheckCache {
  const announced = { ...cache.announced, [sessionId]: { signature, at: now.toISOString() } };
  const newest = Object.entries(announced)
    .sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_REMEMBERED_SESSIONS);
  return { ...cache, announced: Object.fromEntries(newest) };
}
