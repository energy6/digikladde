import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm(new URL('../dist', import.meta.url), { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: [new URL('../src/server.ts', import.meta.url).pathname],
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'info',
  outfile: new URL('../dist/server.cjs', import.meta.url).pathname,
  platform: 'node',
  target: 'node24',
});
