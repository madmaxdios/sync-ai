import fs from 'node:fs';
import path from 'node:path';

function findExecutable(name: string, searchPath: string): string | undefined {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * A PATH that exposes only the named executables (as symlinks inside `baseDir`)
 * plus the directory of the running Node binary. Unlike `PATH=<node dir>`, it keeps
 * tools such as git reachable on CI runners where Node lives in its own directory,
 * while hiding everything else (e.g. `code` or `vimdiff`). POSIX only.
 */
export function minimalPath(baseDir: string, executables: readonly string[]): string {
  const binDir = path.join(baseDir, 'minimal-bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of executables) {
    const target = findExecutable(name, process.env.PATH ?? '');
    if (!target) throw new Error(`minimalPath: ${name} not found on PATH`);
    fs.symlinkSync(target, path.join(binDir, name));
  }
  return [binDir, path.dirname(process.execPath)].join(path.delimiter);
}
