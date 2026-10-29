import { AppError, UsageError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { createDenyMatcher } from '../domain/path-filter';
import {
  ITEM_FOLDERS,
  listItem,
  parseItemKind,
  parseItemName,
  unlistItem,
  type ItemKind,
  type Selection,
} from '../domain/sync-items';
import { selectionOf, withSelection } from '../domain/sync-state';
import { isDirectory, pathExists, toNativePath } from '../infra/file-system';
import { loadState, saveState } from '../infra/state-store';
import type { CommandContext } from './context';

type Change = 'add' | 'remove';

const USAGE = 'usage: <add|remove> <skill|command|agent> <name>';

/** `skills/git` for a skill folder, `commands/deploy.md` (or a folder) for commands and agents. */
async function findLocalItem(context: CommandContext, kind: ItemKind, name: string): Promise<string | undefined> {
  const folder = ITEM_FOLDERS[kind];
  const home = context.agent.home;
  if (kind === 'skill') {
    return (await isDirectory(toNativePath(home, `${folder}/${name}`))) ? `${folder}/${name}` : undefined;
  }
  if (await pathExists(toNativePath(home, `${folder}/${name}.md`))) return `${folder}/${name}.md`;
  return (await isDirectory(toNativePath(home, `${folder}/${name}`))) ? `${folder}/${name}` : undefined;
}

function wasListed(selection: Selection, kind: ItemKind, name: string): string | undefined {
  const folder = ITEM_FOLDERS[kind];
  return [`${folder}/${name}`, `${folder}/${name}.md`].find((key) => selection.listed.includes(key));
}

function readTarget(context: CommandContext): { kind: ItemKind; name: string } {
  const kind = parseItemKind(context.argument);
  const name = kind === undefined ? undefined : parseItemName(kind, context.argument2);
  if (kind === undefined || name === undefined) throw new UsageError(USAGE);
  if (!context.agent.optIn.includes(ITEM_FOLDERS[kind])) {
    throw new AppError(`the ${context.agent.name} agent does not sync ${ITEM_FOLDERS[kind]}`);
  }
  return { kind, name };
}

async function change(context: CommandContext, action: Change): Promise<ExitCode> {
  const { io, agent } = context;
  const { kind, name } = readTarget(context);

  const loaded = await loadState(context.dataHome);
  if (loaded.invalid) io.warn('The sync state file is unreadable: the bases of your files were lost.');
  const selection = selectionOf(loaded.state, agent.name);

  const local = await findLocalItem(context, kind, name);
  const key = local ?? (action === 'remove' ? wasListed(selection, kind, name) : undefined);
  if (key === undefined) {
    throw new AppError(`there is no ${kind} named '${name}' in ${agent.home}/${ITEM_FOLDERS[kind]}`);
  }
  if (createDenyMatcher(agent.deny)(key)) {
    throw new AppError(`${key} is never synced (it is managed by something else or holds private data)`);
  }

  const next = action === 'add' ? listItem(selection, key) : unlistItem(selection, key);
  const message =
    action === 'add'
      ? `Listed ${key}. The next push publishes it.`
      : `Stopped syncing ${key} on this device. Your files and the repository copy were not touched; ` +
        'delete it from the repository yourself if you want it gone there too.';
  if (context.dryRun) {
    io.info(`[dry-run] ${message}`);
    return ExitCode.Ok;
  }
  await saveState(context.dataHome, withSelection(loaded.state, agent.name, next));
  io.info(message);
  return ExitCode.Ok;
}

export function runAdd(context: CommandContext): Promise<ExitCode> {
  return change(context, 'add');
}

export function runRemove(context: CommandContext): Promise<ExitCode> {
  return change(context, 'remove');
}
