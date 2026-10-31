import fs from 'node:fs';
import path from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const kind = argv[2];
if (kind !== 'minor' && kind !== 'patch') {
  stderr.write('Usage: npm run version:<minor|patch>\n');
  exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const current = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) throw new Error(`Unsupported current version: ${current}`);

const major = Number(match[1]);
const minor = Number(match[2]) + (kind === 'minor' ? 1 : 0);
const patch = kind === 'patch' ? Number(match[3]) + 1 : 0;
const next = `${major}.${minor}.${patch}`;

const files = [
  ['package.json', 1],
  ['package-lock.json', 2],
  ['.claude-plugin/plugin.json', 1],
  ['.codex-plugin/plugin.json', 1],
];

for (const [relative, expected] of files) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /("version"\s*:\s*")\d+\.\d+\.\d+("\s*[,}])/g;
  let updatedCount = 0;
  const updated = source.replace(pattern, (whole, before, after) => {
    if (updatedCount >= expected) return whole;
    updatedCount += 1;
    return `${before}${next}${after}`;
  });
  if (updatedCount !== expected) {
    throw new Error(`${relative}: expected ${expected} version fields, found ${updatedCount}`);
  }
  fs.writeFileSync(file, updated);
}

stdout.write(`${current} -> ${next}\n`);
