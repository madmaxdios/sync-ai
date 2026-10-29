import { z } from 'zod';
import { UsageError } from '../domain/app-error';
import { editorChoiceSchema, resolutionSchema, type EditorChoice, type Resolution } from './resolution';

export const cliOptionsSchema = z.object({
  agent: z.string(),
  assumeYes: z.boolean(),
  dryRun: z.boolean(),
  command: z.string().optional(),
  argument: z.string().optional(),
  argument2: z.string().optional(),
  name: z.string().optional(),
  resolution: resolutionSchema.optional(),
  editor: editorChoiceSchema.optional(),
  hook: z.boolean(),
  quiet: z.boolean(),
  all: z.boolean(),
});

export type CliOptions = z.infer<typeof cliOptionsSchema>;

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly options: CliOptions };

const DEFAULT_AGENT = 'claude';

const RESOLUTION_FLAGS = new Map<string, Resolution>([
  ['--take-local', 'take-local'],
  ['--take-repo', 'take-repo'],
  ['--auto', 'auto'],
]);

/** Commands that take two positional arguments after their name. */
const TWO_ARGUMENT_COMMANDS = new Set(['add', 'remove']);

const RESOLUTION_CHOICES = '--take-local, --take-repo, --auto or --editor';

/** Parses arguments in order, like the original shell script. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let agent = DEFAULT_AGENT;
  let assumeYes = false;
  let dryRun = false;
  const positional: string[] = [];
  let name: string | undefined;
  let resolution: Resolution | undefined;
  let editor: EditorChoice | undefined;
  let hook = false;
  let quiet = false;
  let all = false;

  const choose = (value: Resolution): void => {
    if (resolution !== undefined && resolution !== value) {
      throw new UsageError(`choose only one of ${RESOLUTION_CHOICES}`);
    }
    resolution = value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';

    if (arg === '--agent') {
      const value = argv[index + 1];
      if (value === undefined) throw new UsageError('--agent requires a value');
      agent = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--agent=')) {
      agent = arg.slice('--agent='.length);
      continue;
    }
    if (arg === '--name') {
      const value = argv[index + 1];
      if (value === undefined) throw new UsageError('--name requires a value');
      name = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
      continue;
    }
    const flagged = RESOLUTION_FLAGS.get(arg);
    if (flagged) {
      choose(flagged);
      continue;
    }
    if (arg === '--editor' || arg.startsWith('--editor=')) {
      choose('editor');
      const inline = arg.startsWith('--editor=') ? arg.slice('--editor='.length) : undefined;
      const next = argv[index + 1];
      const candidate = inline ?? (editorChoiceSchema.safeParse(next).success ? next : undefined);
      if (inline === undefined && candidate !== undefined) index += 1;
      const parsedEditor = editorChoiceSchema.safeParse(candidate ?? 'auto');
      if (!parsedEditor.success) throw new UsageError('--editor accepts auto, code or vimdiff');
      editor = parsedEditor.data;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--hook') {
      hook = true;
      continue;
    }
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') return { kind: 'help' };
    if (arg.startsWith('-')) throw new UsageError(`unknown option: ${arg}`);
    positional.push(arg);
  }

  const [command, argument, argument2, ...extra] = positional;
  const allowed = command !== undefined && TWO_ARGUMENT_COMMANDS.has(command) ? 2 : 1;
  const surplus = positional.slice(1 + allowed);
  if (surplus.length > 0 || (allowed === 1 && argument2 !== undefined)) {
    throw new UsageError(`unexpected argument: ${allowed === 1 ? argument2 : extra[0]}`);
  }

  const options = cliOptionsSchema.parse({
    agent,
    assumeYes,
    dryRun,
    command,
    argument,
    argument2,
    name,
    resolution,
    editor,
    hook,
    quiet,
    all,
  });
  return { kind: 'run', options };
}
