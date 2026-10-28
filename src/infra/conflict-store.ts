import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../domain/app-error';
import { pathExists, pruneEmptyDirs, removeFile, toNativePath } from './file-system';

const MANIFEST_FILE = 'manifest.json';

const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.object({
      hasLocal: z.boolean(),
      hasRepo: z.boolean(),
      hasBase: z.boolean(),
      recordedAt: z.string(),
    }),
  ),
});

export type ConflictManifest = z.infer<typeof manifestSchema>;
export type ConflictRecord = ConflictManifest['entries'][string];

export interface ConflictContents {
  readonly local: Buffer | undefined;
  readonly repo: Buffer | undefined;
  readonly base: Buffer | undefined;
}

export type ConflictSide = 'local' | 'repo' | 'base';

const SIDES: readonly ConflictSide[] = ['local', 'repo', 'base'];

/**
 * Conflict copies live under `<dataHome>/conflicts/<agent>/`, deliberately NOT next to the
 * originals: in `commands/` or `agents/` a stray `foo_new.md` would be loaded by the agent.
 */
export class ConflictStore {
  constructor(
    private readonly dataHome: string,
    private readonly agent: string,
  ) {}

  get directory(): string {
    return path.join(this.dataHome, 'conflicts', this.agent);
  }

  copyPath(rel: string, side: ConflictSide): string {
    const target = toNativePath(this.directory, `${rel}.${side}`);
    const relative = path.relative(this.directory, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(`refusing to store a conflict copy outside ${this.directory}: ${rel}`);
    }
    return target;
  }

  async load(): Promise<ConflictManifest> {
    try {
      const content = await fs.readFile(path.join(this.directory, MANIFEST_FILE), 'utf8');
      const parsed = manifestSchema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
    } catch {
      // A missing or unreadable manifest simply means there are no recorded conflicts.
    }
    return { version: 1, entries: {} };
  }

  /** Writes the copies of one conflict, removing the sides that do not exist. */
  async write(rel: string, contents: ConflictContents, recordedAt: string): Promise<ConflictRecord> {
    for (const side of SIDES) {
      const target = this.copyPath(rel, side);
      const content = contents[side];
      if (content === undefined) {
        await removeFile(target);
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    return {
      hasLocal: contents.local !== undefined,
      hasRepo: contents.repo !== undefined,
      hasBase: contents.base !== undefined,
      recordedAt,
    };
  }

  async save(manifest: ConflictManifest): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(
      path.join(this.directory, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  /** Removes the copies of one path (and prunes empty folders). */
  async remove(rel: string): Promise<void> {
    for (const side of SIDES) await removeFile(this.copyPath(rel, side));
    if (await pathExists(this.directory)) await pruneEmptyDirsKeepingRoot(this.directory);
  }
}

async function pruneEmptyDirsKeepingRoot(root: string): Promise<void> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await pruneEmptyDirs(path.join(root, entry.name));
  }
}
