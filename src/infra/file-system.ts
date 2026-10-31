import fs from 'node:fs/promises';
import path from 'node:path';

/** Relative paths use `/` everywhere; this maps them to the native separator. */
export function toNativePath(base: string, rel: string): string {
  return path.join(base, ...rel.split('/'));
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Copies a file creating parent folders and keeping mode and timestamps (like `cp -p`). */
export async function copyPreserving(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  const stats = await fs.stat(source);
  await fs.chmod(destination, stats.mode & 0o777);
  await fs.utimes(destination, stats.atime, stats.mtime);
}

export async function removeFile(target: string): Promise<void> {
  await fs.rm(target, { force: true });
}

/** Removes empty directories bottom-up, including `root` itself when it ends up empty. */
export async function pruneEmptyDirs(root: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyDirs(path.join(root, entry.name));
  }
  if ((await fs.readdir(root)).length === 0) await fs.rmdir(root);
}
