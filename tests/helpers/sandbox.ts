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
  /** What the agent would write to a hook's stdin (defaults to nothing). */
  readonly stdin?: string;
  /** The clock of the run (defaults to the real one); lets tests move time forward. */
  readonly now?: () => Date;
  /** The OS user name the scanner keeps out of published files (defaults to a harmless one). */
  readonly username?: string;
}

export interface BundleOptions {
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ExternalRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Device = 'A' | 'B';

export interface SandboxOptions {
  /**
   * Lists every skill, command and agent of the device right before each `push`, as if the user
   * had added them all. Suites that are not about the opt-in list use it; the others leave it off.
   */
  readonly autoList?: boolean;
}

/**
 * Two fake devices (A and B) sharing one bare git repository. HOME and
 * AGENT_SYNC_HOME are isolated inside a temp dir, so nothing touches the real
 * ~/.claude.
 */
export class Sandbox {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
  readonly remote = path.join(this.root, 'remote.git');
  private readonly gitConfig = path.join(this.root, 'gitconfig');

  constructor(private readonly options: SandboxOptions = {}) {
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

  /** A file of the device's data directory (state.json, check-cache.json...), or undefined. */
  dataFile(device: Device, name: string): string | undefined {
    const target = path.join(this.dataHome(device), name);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  }

  writeDataFile(device: Device, name: string, content: string): void {
    fs.mkdirSync(this.dataHome(device), { recursive: true });
    fs.writeFileSync(path.join(this.dataHome(device), name), content);
  }

  removeDataFile(device: Device, name: string): void {
    fs.rmSync(path.join(this.dataHome(device), name), { force: true });
  }

  /** Makes the shared remote unreachable (as if the network were down) until restored. */
  disconnectRemote(): void {
    fs.renameSync(this.remote, `${this.remote}.offline`);
  }

  reconnectRemote(): void {
    if (fs.existsSync(`${this.remote}.offline`)) fs.renameSync(`${this.remote}.offline`, this.remote);
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

  /** Lists the skill, command or agent that contains `rel` (what `add` does); other paths are ignored. */
  async list(device: Device, rel: string): Promise<void> {
    const [folder, unit] = rel.split('/');
    const kind = folder === 'skills' ? 'skill' : folder === 'commands' ? 'command' : folder === 'agents' ? 'agent' : undefined;
    if (kind === undefined || unit === undefined) return;
    const name = kind === 'skill' ? unit : unit.replace(/\.md$/, '');
    const result = await this.run(device, ['add', kind, name]);
    if (result.code !== 0) throw new Error(`could not list ${rel}: ${result.stderr}`);
  }

  /** Lists every skill, command and agent that exists on the device. */
  async listAll(device: Device): Promise<void> {
    for (const folder of ['skills', 'commands', 'agents']) {
      const dir = path.join(this.agentHome(device), folder);
      if (!fs.existsSync(dir)) continue;
      for (const unit of fs.readdirSync(dir)) {
        if (unit === 'synced' || unit.includes('.backup-')) continue;
        await this.list(device, `${folder}/${unit}`);
      }
    }
  }

  async run(device: Device, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    if (this.options.autoList && args[0] === 'push') await this.listAll(device);
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
      now: options.now ?? (() => new Date()),
      username: options.username ?? 'sandbox-user',
      readStdin: () => Promise.resolve(options.stdin ?? ''),
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
   * environment. stdin is closed after `options.stdin`, so prompts behave like a non-interactive session.
   */
  runBundle(
    bundlePath: string,
    device: Device,
    args: readonly string[],
    options: BundleOptions = {},
  ): Promise<ExternalRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bundlePath, '--agent', 'claude', ...args], {
        env: { ...this.env(device), ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      // stdin is always closed right away (empty unless given), like a non-interactive session.
      child.stdin.end(options.stdin ?? '');
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
