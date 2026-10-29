import { execFile, spawn, type ExecFileException } from 'node:child_process';
import type { Env } from '../agents/agent-config';

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface BinaryProcessResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface ProcessOptions {
  /** Kills the process after this many milliseconds (it then resolves with a non-zero code). */
  readonly timeoutMs?: number;
}

/**
 * Runs an executable without a shell. Resolves on non-zero exit codes too and
 * resolves with `undefined` when the executable does not exist.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  env: Env,
  options: ProcessOptions = {},
): Promise<ProcessResult | undefined> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        env: { ...env },
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      },
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

/** Like `runProcess`, but stdout is returned as raw bytes (for file contents). */
export function runProcessBinary(
  file: string,
  args: readonly string[],
  env: Env,
): Promise<BinaryProcessResult | undefined> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { ...env }, encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error: ExecFileException | null, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr: stderr.toString('utf8') });
          return;
        }
        if (error.code === 'ENOENT') {
          resolve(undefined);
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr: stderr.toString('utf8') || error.message });
      },
    );
  });
}

/**
 * Runs an executable attached to the user's terminal (no shell) and resolves with its exit
 * code, or `undefined` when the executable does not exist.
 */
export function runInteractive(
  file: string,
  args: readonly string[],
  env: Env,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], { env: { ...env }, stdio: 'inherit', windowsHide: false });
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'ENOENT' ? undefined : 1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
