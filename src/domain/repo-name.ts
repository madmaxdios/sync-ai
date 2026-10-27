import { z } from 'zod';

export const DEFAULT_REPO_NAME = 'sync-ai-data';

/**
 * A GitHub repository name that is also safe to pass as a CLI argument: it cannot
 * start with a dash and cannot contain path separators or the `.git` suffix.
 */
export const repoNameSchema = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/)
  .refine((name) => !name.endsWith('.git') && !name.includes('..'));
