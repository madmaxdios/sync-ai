import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sandbox } from './helpers/sandbox';

describe('command line handling', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = new Sandbox();
  });

  afterEach(() => sandbox.cleanup());

  it('prints usage on stdout and exits 0 for --help', async () => {
    const result = await sandbox.run('A', ['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: agent-sync');
  });

  it.each([
    ['a missing command', [] as string[], 'missing command'],
    ['an unknown option', ['--nope', 'status'], 'unknown option: --nope'],
    ['an unexpected extra argument', ['status', 'one', 'two'], 'unexpected argument: two'],
    ['an unknown command', ['bogus'], 'unknown command: bogus'],
  ])('exits 2 with usage for %s', async (_name, args, message) => {
    const result = await sandbox.run('A', args);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain('Usage: agent-sync');
  });

  it('exits 2 when --agent has no value', async () => {
    const { runCli } = await import('../src/cli/run');
    const lines: string[] = [];
    const code = await runCli(['--agent'], {
      env: {},
      homeDir: sandbox.home('A'),
      platform: process.platform,
      hostname: 'host',
      io: {
        info: (message) => lines.push(message),
        warn: (message) => lines.push(message),
        confirm: () => Promise.resolve(false),
      },
      now: () => new Date(),
    });

    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('--agent requires a value');
  });

  it.each(['constructor', 'Bad Name', '../x'])('rejects the agent name %s with exit 1', async (agent) => {
    const result = await sandbox.run('A', ['status'], { agent });

    expect(result.code).toBe(1);
  });

  it('asks to run init when there is no local clone', async () => {
    const result = await sandbox.run('A', ['status']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Run first: init [repo-url]');
  });

  it('refuses to init over a clone that points to another remote', async () => {
    await sandbox.run('A', ['init', sandbox.remote]);

    const result = await sandbox.run('A', ['init', `${sandbox.remote}-other`]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('a clone already exists');
  });

  it('does not clone with --dry-run', async () => {
    const result = await sandbox.run('A', ['init', sandbox.remote, '--dry-run']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[dry-run]');
    expect((await sandbox.run('A', ['status'])).code).toBe(1);
  });

  it('reports an empty remote on pull and status', async () => {
    await sandbox.run('A', ['init', sandbox.remote]);

    const pull = await sandbox.run('A', ['pull']);
    const status = await sandbox.run('A', ['status']);

    expect(pull.code).toBe(0);
    expect(pull.stdout).toContain('The remote repository is empty');
    expect(status.stdout).toContain('Remote:      empty');
  });

  it('fails push with exit 1 when there is nothing to sync', async () => {
    await sandbox.run('A', ['init', sandbox.remote]);

    const result = await sandbox.run('A', ['push']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no files to sync');
  });
});
