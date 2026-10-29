import { z } from 'zod';

import { emptySelection, type Selection } from './sync-items';

const bases = z.record(z.string(), z.string());

const selectionSchema = z.object({ listed: z.array(z.string()), unlisted: z.array(z.string()) });

const stateSchema = z.object({
  version: z.literal(1),
  // `synced` was added later: states written before it are still valid and mean "no hand-made changes".
  agents: z.record(z.string(), z.object({ bases, synced: selectionSchema.optional() })),
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
  return { ...state, agents: { ...state.agents, [agent]: { ...state.agents[agent], bases: next } } };
}

export function selectionOf(state: SyncState, agent: string): Selection {
  return state.agents[agent]?.synced ?? emptySelection();
}

export function withSelection(state: SyncState, agent: string, selection: Selection): SyncState {
  const current = state.agents[agent];
  const synced = { listed: [...selection.listed], unlisted: [...selection.unlisted] };
  return { ...state, agents: { ...state.agents, [agent]: { bases: current?.bases ?? {}, synced } } };
}
