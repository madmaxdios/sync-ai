import { AppError } from '../domain/app-error';
import { editorArguments, isSafeForCmd, type Editor, type MergeFiles } from '../domain/editor-command';
import type { EditorChoice } from '../cli/resolution';
import { runInteractive, runProcess } from '../infra/run-process';
import type { Env } from '../agents/agent-config';

async function hasCode(env: Env, platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'win32') return (await runProcess('where', ['code'], env))?.code === 0;
  return (await runProcess('code', ['--version'], env))?.code === 0;
}

async function hasVimdiff(env: Env, platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'win32') return false;
  return (await runProcess('vimdiff', ['--version'], env))?.code === 0;
}

export interface EditorEnvironment {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** vimdiff needs a terminal; VS Code opens its own window. */
  readonly hasTerminal: boolean;
}

/** Picks the editor to use, or undefined when `auto` finds none that can work here. */
export async function chooseEditor(
  choice: EditorChoice,
  { env, platform, hasTerminal }: EditorEnvironment,
): Promise<Editor | undefined> {
  if (choice === 'code') {
    if (!(await hasCode(env, platform))) throw new AppError("the 'code' command was not found in PATH");
    return 'code';
  }
  if (choice === 'vimdiff') {
    if (!hasTerminal) throw new AppError('vimdiff needs a terminal; run this command in your own terminal');
    if (!(await hasVimdiff(env, platform))) throw new AppError("'vimdiff' was not found in PATH");
    return 'vimdiff';
  }
  if (await hasCode(env, platform)) return 'code';
  if (hasTerminal && (await hasVimdiff(env, platform))) return 'vimdiff';
  return undefined;
}

/** Exact commands the user can run by hand when no editor can be launched from here. */
export function manualCommands(files: MergeFiles): string[] {
  return [
    `code --wait --merge "${files.local}" "${files.repo}" "${files.base}" "${files.result}"`,
    `vimdiff "${files.result}" "${files.base}" "${files.repo}"`,
  ];
}

/** Runs the editor attached to the terminal and returns its exit code. */
export async function launchEditor(
  editor: Editor,
  files: MergeFiles,
  { env, platform }: EditorEnvironment,
): Promise<number> {
  const args = editorArguments(editor, files);
  if (editor === 'code' && platform === 'win32') {
    // `code` is code.cmd on Windows, which cannot be started without cmd.exe. Refuse any
    // argument cmd.exe would interpret instead of passing it through a shell string.
    if (!isSafeForCmd(args)) {
      throw new AppError('a file path contains characters that are unsafe to pass to code.cmd');
    }
    const shell = env.ComSpec || 'cmd.exe';
    const code = await runInteractive(shell, ['/d', '/s', '/c', 'code', ...args], env);
    if (code === undefined) throw new AppError('could not start cmd.exe to run code');
    return code;
  }
  const command = editor === 'code' ? 'code' : 'vimdiff';
  const code = await runInteractive(command, args, env);
  if (code === undefined) throw new AppError(`'${command}' was not found in PATH`);
  return code;
}

