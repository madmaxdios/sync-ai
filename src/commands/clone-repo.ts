import fs from 'node:fs/promises';
import { GH_CREDENTIAL_HELPER } from '../domain/github-repo';
import type { CommandContext } from './context';

export interface CloneOptions {
  /** Authenticate over https through `gh auth git-credential`, for this clone only. */
  readonly withGhCredentials?: boolean;
}

/** Clones the user's repository into the data directory. */
export async function cloneRepository(
  context: CommandContext,
  url: string,
  options: CloneOptions = {},
): Promise<void> {
  const { git, repoGit, repoDir, dataHome } = context;
  await fs.mkdir(dataHome, { recursive: true });

  if (!options.withGhCredentials) {
    await git.must(['clone', '--quiet', '--', url, repoDir]);
    return;
  }

  // An empty value first resets any inherited helper, so only gh answers for this repository.
  await git.must([
    '-c',
    'credential.helper=',
    '-c',
    `credential.helper=${GH_CREDENTIAL_HELPER}`,
    'clone',
    '--quiet',
    '--',
    url,
    repoDir,
  ]);
  await repoGit.must(['config', '--local', '--add', 'credential.helper', '']);
  await repoGit.must(['config', '--local', '--add', 'credential.helper', GH_CREDENTIAL_HELPER]);
}
