import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli/run';
import type { Io } from '../../src/infra/io';

export interface RunResult {
  readonly code: number;
  /** stdout and stderr interleaved in emission order (like `2>&1`). */
  readonly output: string;
  readonly stdout: string;
  readonly stderr: string;
  /** Confirmation questions asked during the run. */
  readonly questions: readonly string[];
}

export interface RunOptions {
  /** Answer given to confirmation prompts; false simulates a non-interactive session. */
  readonly confirm?: boolean;
  /** Agent passed with --agent (defaults to claude). */
  readonly agent?: string;
  /** Environment overrides for the run (e.g. a fake `gh` on PATH). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ExternalRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Device = 'A' | 'B';

/**
 * Two fake devices (A and B) sharing one bare git repository. HOME and
 * AGENT_SYNC_HOME are isolated inside a temp dir, so nothing touches the real
 * ~/.claude.
 */
export class Sandbox {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
  readonly remote = path.join(this.root, 'remote.git');
  private readonly gitConfig = path.join(this.root, 'gitconfig');

  constructor() {
    fs.writeFileSync(this.gitConfig, '[init]\n\tdefaultBranch = main\n');
    this.git(['init', '-q', '--bare', this.remote]);
    for (const device of ['A', 'B'] as const) {
      fs.mkdirSync(this.agentHome(device), { recursive: true });
    }
  }

  home(device: Device): string {
    return path.join(this.root, `home${device}`);
  }

  agentHome(device: Device): string {
    return path.join(this.home(device), '.claude');
  }

  /** Path of the isolated global git config shared by every device. */
  get globalGitConfig(): string {
    return this.gitConfig;
  }

  dataHome(device: Device): string {
    return path.join(this.root, `data${device}`);
  }

  write(device: Device, rel: string, content: string): void {
    const target = path.join(this.agentHome(device), ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  read(device: Device, rel: string): string | undefined {
    const target = path.join(this.agentHome(device), ...rel.split('/'));
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  }

  exists(device: Device, rel: string): boolean {
    return fs.existsSync(path.join(this.agentHome(device), ...rel.split('/')));
  }

  remove(device: Device, rel: string): void {
    fs.rmSync(path.join(this.agentHome(device), ...rel.split('/')), { recursive: true, force: true });
  }

  backupsOf(device: Device, rel: string): string[] {
    const target = path.join(this.agentHome(device), ...rel.split('/'));
    const prefix = `${path.basename(target)}.backup-`;
    return fs
      .readdirSync(path.dirname(target))
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(path.dirname(target), name));
  }

  async run(device: Device, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    const entries: { stream: 'out' | 'err'; text: string }[] = [];
    const questions: string[] = [];
    const io: Io = {
      info: (message) => entries.push({ stream: 'out', text: message }),
      warn: (message) => entries.push({ stream: 'err', text: message }),
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(options.confirm ?? false);
      },
    };
    const code = await runCli(['--agent', options.agent ?? 'claude', ...args], {
      env: { ...this.env(device), ...options.env },
      homeDir: this.home(device),
      platform: process.platform,
      hostname: `device-${device}.local`,
      io,
      now: () => new Date(),
    });
    const join = (stream?: 'out' | 'err'): string =>
      entries
        .filter((entry) => stream === undefined || entry.stream === stream)
        .map((entry) => entry.text)
        .join('\n');
    return { code, output: join(), stdout: join('out'), stderr: join('err'), questions };
  }

  /**
   * Runs a built bundle as a real external process (no shell) with the device's isolated
   * environment. stdin is closed, so prompts behave like a non-interactive session.
   */
  runBundle(bundlePath: string, device: Device, args: readonly string[]): Promise<ExternalRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bundlePath, '--agent', 'claude', ...args], {
        env: this.env(device),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }

  /** Files tracked on the remote main branch, one path per entry. */
  remoteFiles(): string[] {
    const out = this.tryGit(['--git-dir', this.remote, 'ls-tree', '-r', '--name-only', 'main']);
    return out.split('\n').filter(Boolean);
  }

  remoteHead(): string {
    return this.tryGit(['--git-dir', this.remote, 'rev-parse', '-q', '--verify', 'main']).trim() || 'none';
  }

  remoteContains(text: string): boolean {
    return this.tryGit(['--git-dir', this.remote, 'grep', '-q', text, 'main'], true) === 'match';
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  private env(device: Device): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('GIT_') || key === 'CLAUDE_CONFIG_DIR') continue;
      env[key] = value;
    }
    return {
      ...env,
      HOME: this.home(device),
      USERPROFILE: this.home(device),
      AGENT_SYNC_HOME: this.dataHome(device),
      GIT_CONFIG_GLOBAL: this.gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    };
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return { ...this.env('A') };
  }

  private git(args: string[]): void {
    execFileSync('git', args, { env: this.gitEnv(), stdio: 'ignore' });
  }

  private tryGit(args: string[], matchOnly = false): string {
    try {
      const out = execFileSync('git', args, { env: this.gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return matchOnly ? 'match' : out;
    } catch {
      return '';
    }
  }
}
