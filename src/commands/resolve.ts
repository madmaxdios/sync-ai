import fs from 'node:fs/promises';
import { AppError, UsageError } from '../domain/app-error';
import { ExitCode } from '../domain/exit-code';
import { isBinary } from '../domain/line-endings';
import { basesOf, setBase } from '../domain/sync-state';
import { copyPreserving, pathExists, toNativePath } from '../infra/file-system';
import { loadState, saveState } from '../infra/state-store';
import { formatStamp } from '../domain/report';
import { installFromSnapshot, removeLocalWithBackup } from './apply-repo';
import { conflictStoreOf } from './conflict-area';
import type { CommandContext } from './context';
import { requireRepo } from './local-tree';
import { readRepoSnapshot, type RepoSnapshot } from './repo-snapshot';
import { chooseEditor, launchEditor, manualCommands } from './resolve-editor';

/** Accepts `skills\\x\\SKILL.md` and `./CLAUDE.md` the way the list prints them. */
function normalizePath(argument: string): string {
  return argument.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function listConflicts(context: CommandContext): Promise<ExitCode> {
  const { io } = context;
  const store = conflictStoreOf(context);
  const rels = Object.keys((await store.load()).entries).sort();
  if (rels.length === 0) {
    io.info("No unresolved conflicts. ('pull' records the conflicts it finds.)");
    return ExitCode.Ok;
  }

  io.info(`Unresolved conflicts (${rels.length}):`);
  for (const rel of rels) io.info(`  ! ${rel}`);
  io.info(`Comparison copies (.local, .repo, .base): ${store.directory}`);
  io.info('Resolve each file with: resolve <path> --take-local | --take-repo | --auto | --editor');
  return ExitCode.Ok;
}

interface Versions {
  readonly local: Buffer | undefined;
  readonly repo: Buffer | undefined;
  readonly base: Buffer | undefined;
}

async function readVersions(
  context: CommandContext,
  snapshot: RepoSnapshot,
  rel: string,
): Promise<Versions> {
  const localPath = toNativePath(context.agent.home, rel);
  const local = (await pathExists(localPath)) ? await fs.readFile(localPath) : undefined;
  const repoBlob = snapshot.blobs.get(rel);
  const repo = repoBlob ? await snapshot.read(repoBlob) : undefined;
  const { state } = await loadState(context.dataHome);
  const baseBlob = basesOf(state, context.agent.name)[rel];
  const base = baseBlob ? await context.repoGit.blob(baseBlob) : undefined;
  return { local, repo, base };
}

/** Marks a conflict as settled: the repository version becomes the new base. */
async function settle(context: CommandContext, rel: string, repoBlob: string | undefined): Promise<void> {
  const { state } = await loadState(context.dataHome);
  await saveState(context.dataHome, setBase(state, context.agent.name, rel, repoBlob));

  const store = conflictStoreOf(context);
  const manifest = await store.load();
  const entries = { ...manifest.entries };
  delete entries[rel];
  await store.remove(rel);
  await store.save({ version: 1, entries });
}

async function backUpLocal(context: CommandContext, rel: string): Promise<void> {
  const target = toNativePath(context.agent.home, rel);
  if (!(await pathExists(target))) return;
  await copyPreserving(target, `${target}.backup-${formatStamp(context.now())}`);
}

async function takeLocal(context: CommandContext, rel: string, snapshot: RepoSnapshot): Promise<ExitCode> {
  await settle(context, rel, snapshot.blobs.get(rel));
  const exists = await pathExists(toNativePath(context.agent.home, rel));
  context.io.info(
    exists
      ? `Kept your local version of ${rel}. The next 'push' publishes it.`
      : `Kept your local deletion of ${rel}. The next 'push' removes it from the repository.`,
  );
  return ExitCode.Ok;
}

async function takeRepo(context: CommandContext, rel: string, snapshot: RepoSnapshot): Promise<ExitCode> {
  if (snapshot.blobs.has(rel)) await installFromSnapshot(context, snapshot, [rel]);
  else await removeLocalWithBackup(context, rel);
  await settle(context, rel, snapshot.blobs.get(rel));
  context.io.info(`Took the repository version of ${rel} (a .backup-* copy of your file was kept).`);
  return ExitCode.Ok;
}

async function autoMerge(
  context: CommandContext,
  rel: string,
  snapshot: RepoSnapshot,
  versions: Versions,
): Promise<ExitCode> {
  const { local, repo, base } = versions;
  if (!local || !repo || !base) {
    throw new AppError(
      `${rel} was deleted on one side or has no recorded ancestor, so it cannot be merged automatically. ` +
        'Use --take-local or --take-repo.',
    );
  }
  if (isBinary(local) || isBinary(repo) || isBinary(base)) {
    throw new AppError(`${rel} is a binary file and cannot be merged automatically. Use --take-local or --take-repo.`);
  }

  const store = conflictStoreOf(context);
  await store.write(rel, versions, context.now().toISOString());
  const merge = await context.git.run([
    'merge-file',
    '-p',
    toNativePath(context.agent.home, rel),
    store.copyPath(rel, 'base'),
    store.copyPath(rel, 'repo'),
  ]);
  if (merge.code < 0 || merge.code > 127) {
    throw new AppError(`git merge-file failed: ${merge.stderr.trim() || `exit code ${merge.code}`}`);
  }
  if (merge.code > 0) {
    context.io.warn(
      `${rel} still conflicts (${merge.code} overlapping change(s)): nothing was changed. ` +
        'Use --editor, --take-local or --take-repo.',
    );
    return ExitCode.Conflicts;
  }

  await backUpLocal(context, rel);
  await fs.writeFile(toNativePath(context.agent.home, rel), merge.stdout);
  await settle(context, rel, snapshot.blobs.get(rel));
  context.io.info(`Merged ${rel} automatically. Review it, then run 'push' to publish the result.`);
  return ExitCode.Ok;
}

async function editInEditor(
  context: CommandContext,
  rel: string,
  snapshot: RepoSnapshot,
  versions: Versions,
): Promise<ExitCode> {
  const { io } = context;
  const { local, repo, base } = versions;
  if (!local || !repo) {
    throw new AppError(
      `${rel} was deleted on one side, so there is nothing to merge in an editor. Use --take-local or --take-repo.`,
    );
  }

  const store = conflictStoreOf(context);
  await store.write(rel, { local, repo, base: base ?? Buffer.alloc(0) }, context.now().toISOString());
  const files = {
    local: store.copyPath(rel, 'local'),
    repo: store.copyPath(rel, 'repo'),
    base: store.copyPath(rel, 'base'),
    result: toNativePath(context.agent.home, rel),
  };

  const environment = {
    env: context.env,
    platform: context.platform,
    hasTerminal: context.hasTerminal,
  };
  const editor = await chooseEditor(context.editor ?? 'auto', environment);
  if (!editor) {
    io.warn('No three-way editor can be started from here (no VS Code `code` command, and no terminal for vimdiff).');
    io.warn('Open one yourself with either of these commands, then run resolve <path> --take-local:');
    for (const command of manualCommands(files)) io.warn(`  ${command}`);
    return ExitCode.Error;
  }

  await backUpLocal(context, rel);
  io.info(`Opening ${editor} for ${rel}: left/right are your version and the repository's; the result is written to ${files.result}`);
  const code = await launchEditor(editor, files, environment);
  if (code !== 0) {
    throw new AppError(`the editor exited with code ${code}; the conflict on ${rel} is still open`);
  }

  const confirmed =
    context.assumeYes || (await io.confirm(`Mark ${rel} as resolved with the result in your file? (y/N) `));
  if (!confirmed) {
    io.warn(`The conflict on ${rel} is still open. Your edits are in ${files.result}.`);
    io.warn(`When you are happy with that file, run: resolve ${rel} --take-local`);
    return ExitCode.ConfirmationRequired;
  }
  return takeLocal(context, rel, snapshot);
}

export async function runResolve(context: CommandContext): Promise<ExitCode> {
  await requireRepo(context);
  const { argument, resolution, io } = context;
  if (!argument) {
    if (resolution) throw new UsageError(`--${resolution} needs the path of the conflicting file: resolve <path> --${resolution}`);
    return listConflicts(context);
  }
  if (!resolution) {
    throw new UsageError(`choose how to resolve ${argument}: --take-local, --take-repo, --auto or --editor`);
  }

  const rel = normalizePath(argument);
  const store = conflictStoreOf(context);
  if (!(rel in (await store.load()).entries)) {
    throw new AppError(`'${rel}' is not an unresolved conflict. Run 'resolve' to list them.`);
  }

  if (context.dryRun) {
    io.info(`[dry-run] Would resolve ${rel} with --${resolution}; nothing was changed.`);
    return ExitCode.Ok;
  }

  const snapshot = await readRepoSnapshot(context, 'HEAD');
  switch (resolution) {
    case 'take-local':
      return takeLocal(context, rel, snapshot);
    case 'take-repo':
      return takeRepo(context, rel, snapshot);
    case 'auto':
      return autoMerge(context, rel, snapshot, await readVersions(context, snapshot, rel));
    case 'editor':
      return editInEditor(context, rel, snapshot, await readVersions(context, snapshot, rel));
  }
}
