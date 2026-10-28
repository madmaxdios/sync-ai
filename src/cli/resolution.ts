import { z } from 'zod';

export const resolutionSchema = z.enum(['take-local', 'take-repo', 'auto', 'editor']);
export type Resolution = z.infer<typeof resolutionSchema>;

export const editorChoiceSchema = z.enum(['auto', 'code', 'vimdiff']);
export type EditorChoice = z.infer<typeof editorChoiceSchema>;
