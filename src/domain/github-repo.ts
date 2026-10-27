import { z } from 'zod';
import { AppError } from './app-error';

/** Credential helper that lets git reuse the user's `gh` login over https. */
export const GH_CREDENTIAL_HELPER = '!gh auth git-credential';

export const gitProtocolSchema = z.enum(['ssh', 'https']);

export type GitProtocol = z.infer<typeof gitProtocolSchema>;

const repoInfoSchema = z.object({
  isPrivate: z.boolean(),
  url: z.string().min(1),
  sshUrl: z.string().min(1),
});

export type RepoInfo = z.infer<typeof repoInfoSchema>;

/** Parses `gh repo view --json isPrivate,url,sshUrl`. */
export function parseRepoInfo(json: string): RepoInfo {
  try {
    return repoInfoSchema.parse(JSON.parse(json));
  } catch {
    throw new AppError('could not understand the repository information returned by gh');
  }
}

/** Reads `gh config get git_protocol`; anything unexpected falls back to https. */
export function parseGitProtocol(output: string): GitProtocol {
  const parsed = gitProtocolSchema.safeParse(output.trim());
  return parsed.success ? parsed.data : 'https';
}

export function cloneUrl(info: RepoInfo, protocol: GitProtocol): string {
  return protocol === 'ssh' ? info.sshUrl : `${info.url}.git`;
}

/** True when `gh repo view` failed because the repository does not exist. */
export function isRepoNotFound(stderr: string): boolean {
  return /could not resolve to a repository|http 404|not found/i.test(stderr);
}
