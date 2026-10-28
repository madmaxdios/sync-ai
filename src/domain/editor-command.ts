import type { EditorChoice } from '../cli/resolution';

export type Editor = Exclude<EditorChoice, 'auto'>;

export interface MergeFiles {
  /** Copy of the local version at the time of the conflict. */
  readonly local: string;
  /** Copy of the repository version. */
  readonly repo: string;
  /** Copy of the common ancestor. */
  readonly base: string;
  /** The real local file: the editor writes the merged result here. */
  readonly result: string;
}

/**
 * Arguments of the three-way editors. VS Code: `code --wait --merge <path1> <path2> <base>
 * <result>`. vimdiff has no result file, so the real local file is the first window and the
 * ancestor and the repository version follow it.
 */
export function editorArguments(editor: Editor, files: MergeFiles): string[] {
  if (editor === 'code') return ['--wait', '--merge', files.local, files.repo, files.base, files.result];
  return [files.result, files.base, files.repo];
}

/** Characters cmd.exe would interpret when `code.cmd` is started through it on Windows. */
const CMD_METACHARACTERS = /[&|<>^%!"]/;

export function isSafeForCmd(args: readonly string[]): boolean {
  return args.every((arg) => !CMD_METACHARACTERS.test(arg));
}
