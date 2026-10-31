import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyPreserving } from '../src/infra/file-system';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('copyPreserving', () => {
  it('preserves executable permissions for synced scripts', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sync-file-system-'));
    temporaryDirectories.push(directory);
    const source = path.join(directory, 'source.sh');
    const destination = path.join(directory, 'nested', 'destination.sh');
    await fs.writeFile(source, '#!/bin/sh\n', { mode: 0o755 });

    await copyPreserving(source, destination);

    expect((await fs.stat(destination)).mode & 0o777).toBe(0o755);
  });
});
