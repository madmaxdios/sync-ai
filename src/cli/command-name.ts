import { z } from 'zod';

export const commandNameSchema = z.enum(['init', 'pull', 'push', 'status', 'resolve']);

export type CommandName = z.infer<typeof commandNameSchema>;
