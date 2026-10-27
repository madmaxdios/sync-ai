import { z } from 'zod';

export const commandNameSchema = z.enum(['init', 'pull', 'push', 'status']);

export type CommandName = z.infer<typeof commandNameSchema>;
