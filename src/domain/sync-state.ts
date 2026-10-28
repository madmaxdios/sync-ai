import { z } from 'zod';

const bases = z.record(z.string(), z.string());

const stateSchema = z.object({
  version: z.literal(1),
  agents: z.record(z.string(), z.object({ bases })),
});

/**
 * What this device last had in sync with the repository: for every synced path, the git
 * blob id of that version. It is the common ancestor used for three-way comparisons.
 */
export type SyncState = z.infer<typeof stateSchema>;

export function emptyState(): SyncState {
  return { version: 1, agents: {} };
}

/** Returns undefined when the content is not a valid state file. */
export function parseState(json: string): SyncState | undefined {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function serializeState(state: SyncState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function basesOf(state: SyncState, agent: string): Readonly<Record<string, string>> {
  return state.agents[agent]?.bases ?? {};
}

/** Returns a copy with the base of one path set, or removed when `blob` is undefined. */
export function setBase(
  state: SyncState,
  agent: string,
  rel: string,
  blob: string | undefined,
): SyncState {
  const next = { ...basesOf(state, agent) };
  if (blob === undefined) delete next[rel];
  else next[rel] = blob;
  return { ...state, agents: { ...state.agents, [agent]: { bases: next } } };
}
