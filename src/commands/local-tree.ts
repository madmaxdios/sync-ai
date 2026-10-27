import path from 'node:path';
import fs from 'node:fs/promises';
import { AppError } from '../domain/app-error';
import { createDenyMatcher } from '../domain/path-filter';
import { sameContent } from '../domain/line-endings';
import { diffTrees, type TreeDifferences } from '../domain/tree-differences';
import { isDirectory, toNativePath } from '../infra/file-system';
import { listTree } from '../infra/file-tree';
import type { CommandContext } from './context';

export function agentRepoDir(context: CommandContext): string {
  return path.join(context.repoDir, context.agent.name);
}

export function listLocalFiles(context: CommandContext): Promise<string[]> {
  const { home, allow, deny } = context.agent;
  return listTree(home, allow, createDenyMatcher(deny));
}

export function listRepoFiles(context: CommandContext): Promise<string[]> {
  const { allow, deny } = context.agent;
  return listTree(agentRepoDir(context), allow, createDenyMatcher(deny));
}

export async function requireRepo(context: CommandContext): Promise<void> {
  if (await isDirectory(path.join(context.repoDir, '.git'))) return;
  throw new AppError(
    `no repository initialized at ${context.repoDir}. Run first: init [repo-url]`,
  );
}

export async function differsFromRepo(context: CommandContext, rel: string): Promise<boolean> {
  const [local, repo] = await Promise.all([
    fs.readFile(toNativePath(context.agent.home, rel)),
    fs.readFile(toNativePath(agentRepoDir(context), rel)),
  ]);
  return !sameContent(local, repo);
}

export interface LocalComparison extends TreeDifferences {
  readonly modified: readonly string[];
}

export async function compareWithRepo(context: CommandContext): Promise<LocalComparison> {
  const [localFiles, repoFiles] = await Promise.all([
    listLocalFiles(context),
    listRepoFiles(context),
  ]);
  const differences = diffTrees(localFiles, repoFiles);
  const modified: string[] = [];
  for (const rel of differences.common) {
    if (await differsFromRepo(context, rel)) modified.push(rel);
  }
  return { ...differences, modified };
}
