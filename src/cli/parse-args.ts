import { z } from 'zod';
import { UsageError } from '../domain/app-error';

export const cliOptionsSchema = z.object({
  agent: z.string(),
  assumeYes: z.boolean(),
  dryRun: z.boolean(),
  command: z.string().optional(),
  argument: z.string().optional(),
});

export type CliOptions = z.infer<typeof cliOptionsSchema>;

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly options: CliOptions };

const DEFAULT_AGENT = 'claude';

/** Parses arguments in order, like the original shell script. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let agent = DEFAULT_AGENT;
  let assumeYes = false;
  let dryRun = false;
  let command: string | undefined;
  let argument: string | undefined;

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
    if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') return { kind: 'help' };
    if (arg.startsWith('-')) throw new UsageError(`unknown option: ${arg}`);

    if (!command) {
      command = arg;
      continue;
    }
    if (!argument) {
      argument = arg;
      continue;
    }
    throw new UsageError(`unexpected argument: ${arg}`);
  }

  const options = cliOptionsSchema.parse({ agent, assumeYes, dryRun, command, argument });
  return { kind: 'run', options };
}
