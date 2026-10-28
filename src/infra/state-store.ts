import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyState, parseState, serializeState, type SyncState } from '../domain/sync-state';

const STATE_FILE = 'state.json';

export interface LoadedState {
  readonly state: SyncState;
  /** True when a state file existed but could not be understood (it is treated as empty). */
  readonly invalid: boolean;
}

export async function loadState(dataHome: string): Promise<LoadedState> {
  let content: string;
  try {
    content = await fs.readFile(path.join(dataHome, STATE_FILE), 'utf8');
  } catch {
    return { state: emptyState(), invalid: false };
  }
  const parsed = parseState(content);
  return parsed ? { state: parsed, invalid: false } : { state: emptyState(), invalid: true };
}

/** Writes the state through a temporary file so a crash never leaves it half written. */
export async function saveState(dataHome: string, state: SyncState): Promise<void> {
  await fs.mkdir(dataHome, { recursive: true });
  const target = path.join(dataHome, STATE_FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, serializeState(state));
  await fs.rename(temporary, target);
}
