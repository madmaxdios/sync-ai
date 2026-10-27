import { execFile, type ExecFileException } from 'node:child_process';
import type { Env } from '../agents/agent-config';

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Runs an executable without a shell. Resolves on non-zero exit codes too and
 * resolves with `undefined` when the executable does not exist.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  env: Env,
): Promise<ProcessResult | undefined> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { ...env }, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error: ExecFileException | null, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (error.code === 'ENOENT') {
          resolve(undefined);
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr: stderr || error.message });
      },
    );
  });
}
