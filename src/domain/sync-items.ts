export type ItemKind = 'skill' | 'command' | 'agent';

export const ITEM_KINDS: readonly ItemKind[] = ['skill', 'command', 'agent'];

/** The folder that holds each kind of item. */
export const ITEM_FOLDERS: Readonly<Record<ItemKind, string>> = {
  skill: 'skills',
  command: 'commands',
  agent: 'agents',
};

const ITEM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseItemKind(value: string | undefined): ItemKind | undefined {
  return ITEM_KINDS.find((kind) => kind === value || ITEM_FOLDERS[kind] === value);
}

/** Strips a trailing `.md` and returns the bare name, or undefined when it is not a plain name. */
export function parseItemName(kind: ItemKind, value: string | undefined): string | undefined {
  const name = kind === 'skill' ? value : value?.replace(/\.md$/i, '');
  return name !== undefined && ITEM_NAME.test(name) ? name : undefined;
}

/**
 * The unit that is listed or not: `skills/git` for everything inside a skill, `commands/deploy.md`
 * for a command. Paths outside the opt-in folders have no unit: they are always synced.
 */
export function itemOf(rel: string, optIn: readonly string[]): string | undefined {
  const [folder, unit] = rel.split('/');
  if (folder === undefined || unit === undefined || !optIn.includes(folder)) return undefined;
  return `${folder}/${unit}`;
}

export function itemsOf(rels: Iterable<string>, optIn: readonly string[]): Set<string> {
  const items = new Set<string>();
  for (const rel of rels) {
    const item = itemOf(rel, optIn);
    if (item !== undefined) items.add(item);
  }
  return items;
}

/** What the device lists on its own: items added by hand and items stopped by hand. */
export interface Selection {
  readonly listed: readonly string[];
  readonly unlisted: readonly string[];
}

export function emptySelection(): Selection {
  return { listed: [], unlisted: [] };
}

/**
 * Items that are synced: those added by hand, every item the repository has, and every item this
 * device already synced before (so one that another device deleted is still recognised as
 * "removed from the repository" instead of silently becoming unlisted), minus those the user
 * stopped. Deriving the repository part is also the migration for states that predate the list.
 */
export function effectiveItems(
  selection: Selection,
  repoItems: ReadonlySet<string>,
  syncedBefore: ReadonlySet<string> = new Set(),
): Set<string> {
  const stopped = new Set(selection.unlisted);
  return new Set([...selection.listed, ...repoItems, ...syncedBefore].filter((item) => !stopped.has(item)));
}

export function isSynced(rel: string, optIn: readonly string[], effective: ReadonlySet<string>): boolean {
  const item = itemOf(rel, optIn);
  return item === undefined || effective.has(item);
}

function without(items: readonly string[], item: string): string[] {
  return items.filter((existing) => existing !== item);
}

export function listItem(selection: Selection, item: string): Selection {
  return { listed: [...without(selection.listed, item), item].sort(), unlisted: without(selection.unlisted, item) };
}

export function unlistItem(selection: Selection, item: string): Selection {
  return { listed: without(selection.listed, item), unlisted: [...without(selection.unlisted, item), item].sort() };
}
