import path from 'node:path';
import { AppError } from '../domain/app-error';
import { createDenyMatcher } from '../domain/path-filter';
import { isDirectory } from '../infra/file-system';
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
