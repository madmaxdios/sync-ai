import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_GH_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const state = process.env.FAKE_GH_STATE;
const login = process.env.FAKE_GH_LOGIN || 'tester';
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'calls.log'), args.join(' ') + '\\n');

const remoteDir = (slug) => path.join(state, 'remotes', ...slug.split('/')) + '.git';
const fail = (message, code = 1) => {
  process.stderr.write(message + '\\n');
  process.exit(code);
};
const key = args.slice(0, 2).join(' ');

if (args[0] === '--version') {
  console.log('gh version 2.0.0 (fake)');
} else if (key === 'auth status') {
  if (process.env.FAKE_GH_AUTH === '0') fail('You are not logged into any GitHub hosts. To log in, run: gh auth login');
  console.log('Logged in to github.com account ' + login);
} else if (key === 'api user') {
  console.log(login);
} else if (key === 'config get') {
  console.log(process.env.FAKE_GH_PROTOCOL || 'https');
} else if (key === 'repo view') {
  const dir = remoteDir(args[2]);
  if (!fs.existsSync(dir)) fail("GraphQL: Could not resolve to a Repository with the name '" + args[2] + "'. (repository)");
  console.log(JSON.stringify({
    isPrivate: !fs.existsSync(path.join(dir, 'fake-public')),
    url: dir.slice(0, -'.git'.length),
    sshUrl: dir,
  }));
} else if (key === 'repo create') {
  if (!args.includes('--private') || args.includes('--public')) fail('fake gh: refusing to create a non-private repository');
  const dir = remoteDir(login + '/' + args[2]);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', dir]);
  if (process.env.FAKE_GH_FORCE_PUBLIC === '1') fs.writeFileSync(path.join(dir, 'fake-public'), '');
  console.log('https://github.com/' + login + '/' + args[2]);
} else {
  fail('fake gh: unsupported command: ' + args.join(' '));
}
`;

export interface FakeGhOptions {
  readonly authenticated?: boolean;
  readonly protocol?: 'ssh' | 'https';
  readonly login?: string;
  /** Makes the created repository report isPrivate=false. */
  readonly forcePublic?: boolean;
}

/** A fake `gh` executable backed by local bare repositories (POSIX only). */
export class FakeGh {
  private readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-gh-'));
  private readonly binDir = path.join(this.root, 'bin');
  private readonly stateDir = path.join(this.root, 'state');

  constructor() {
    fs.mkdirSync(this.binDir, { recursive: true });
    fs.mkdirSync(path.join(this.stateDir, 'remotes'), { recursive: true });
    const script = path.join(this.binDir, 'gh');
    fs.writeFileSync(script, FAKE_GH_SCRIPT, { mode: 0o755 });
  }

  /** Environment overrides that put the fake gh first on PATH. */
  env(options: FakeGhOptions = {}): Record<string, string | undefined> {
    return {
      PATH: `${this.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_STATE: this.stateDir,
      FAKE_GH_LOGIN: options.login ?? 'tester',
      FAKE_GH_AUTH: options.authenticated === false ? '0' : '1',
      FAKE_GH_PROTOCOL: options.protocol ?? 'https',
      FAKE_GH_FORCE_PUBLIC: options.forcePublic ? '1' : '0',
    };
  }

  /** Every invocation of the fake, one line of space-joined arguments each. */
  calls(): string[] {
    const log = path.join(this.stateDir, 'calls.log');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  }

  /** Repositories that exist on the fake GitHub, as `login/name`. */
  repositories(): string[] {
    const remotes = path.join(this.stateDir, 'remotes');
    const found: string[] = [];
    for (const owner of fs.readdirSync(remotes)) {
      for (const repo of fs.readdirSync(path.join(remotes, owner))) {
        found.push(`${owner}/${repo.replace(/\.git$/, '')}`);
      }
    }
    return found.sort();
  }

  remoteDir(slug: string): string {
    return path.join(this.stateDir, 'remotes', ...slug.split('/')) + '.git';
  }

  seedRepository(slug: string): void {
    const dir = this.remoteDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '--quiet', '--bare', dir], { stdio: 'ignore' });
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

/** PATH with every directory that provides a `gh` executable removed. */
export function pathWithoutGh(): string {
  const executable = process.platform === 'win32' ? 'gh.exe' : 'gh';
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir !== '' && !fs.existsSync(path.join(dir, executable)))
    .join(path.delimiter);
}
