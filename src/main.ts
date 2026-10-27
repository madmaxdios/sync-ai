import { runCli, defaultRuntime } from './cli/run';
import { isAffirmative } from './domain/answers';
import { createConsoleIo } from './infra/io';

process.exitCode = await runCli(
  process.argv.slice(2),
  defaultRuntime(createConsoleIo(isAffirmative)),
);
