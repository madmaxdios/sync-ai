import { z } from 'zod';

export const commandNameSchema = z.enum(['sync', 'init', 'pull', 'push', 'status', 'resolve', 'check', 'add', 'remove']);

export type CommandName = z.infer<typeof commandNameSchema>;
