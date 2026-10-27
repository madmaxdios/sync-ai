import { build } from 'esbuild';
import { argv } from 'node:process';

// Single source of truth for the bundle: `npm run build` and the freshness test both go through here.
const outfile = argv[2] ?? 'dist/agent-sync.mjs';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  outfile,
  logLevel: 'warning',
});
