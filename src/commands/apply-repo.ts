import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../domain/app-error';
import { formatStamp } from '../domain/report';
import { copyPreserving, pathExists, removeFile, toNativePath } from '../infra/file-system';
import type { CommandContext } from './context';
import type { RepoSnapshot } from './repo-snapshot';

/** Keeps a timestamped `.backup-*` copy of a local file before it is replaced or removed. */
async function backUp(context: CommandContext, destination: string): Promise<void> {
  if (!(await pathExists(destination))) return;
  await copyPreserving(destination, `${destination}.backup-${formatStamp(context.now())}`);
}

/** Writes the repository version of the given files into the agent's home (backups kept). */
export async function installFromSnapshot(
  context: CommandContext,
  snapshot: RepoSnapshot,
  rels: readonly string[],
): Promise<void> {
  for (const rel of rels) {
    const blobId = snapshot.blobs.get(rel);
    if (!blobId) throw new AppError(`${rel} is not in the repository`);
    const content = await snapshot.read(blobId);
    if (!content) throw new AppError(`the repository object for ${rel} is missing from the clone`);

    const destination = toNativePath(context.agent.home, rel);
    await backUp(context, destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { mode: snapshot.executable.has(rel) ? 0o755 : 0o644 });
  }
}

/** Removes a local file (a `.backup-*` copy is kept). */
export async function removeLocalWithBackup(context: CommandContext, rel: string): Promise<void> {
  const target = toNativePath(context.agent.home, rel);
  await backUp(context, target);
  await removeFile(target);
}
