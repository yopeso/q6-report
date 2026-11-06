// Builds what the npm package ships into dist/: the library and the q6-report command as JavaScript, with the report
// page bundled in so an install needs no esbuild, and the type declarations. A script because the page has to be built
// first and handed to the bundle as a value.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { relativeTsPaths } from './declaration-paths.ts';
import { buildClient } from './src/build-client.ts';

/**
 * The declarations keep the source's import paths, e.g: './render.ts', which TypeScript before 5.0 refuses in a
 * package, so each becomes the './render.js' the package ships; TypeScript's own rewriting leaves declarations alone.
 */
function rewriteDeclarationPaths(file: string): void {
  const text = readFileSync(file, 'utf8');
  const edits = relativeTsPaths(file, text)
    .map((literal) => ({ start: literal.getStart() + 1, end: literal.getEnd() - 1, path: literal.text.replace(/\.ts$/, '.js') }))
    .sort((a, b) => b.start - a.start);
  const rewritten = edits.reduce((out, edit) => out.slice(0, edit.start) + edit.path + out.slice(edit.end), text);
  const left = relativeTsPaths(file, rewritten);
  if (left.length) throw new Error(`${file} still names ${left.map((literal) => literal.text).join(', ')}`);
  writeFileSync(file, rewritten);
}

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(packageDir, 'dist');

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: [path.join(packageDir, 'src', 'index.ts'), path.join(packageDir, 'src', 'cli.ts')],
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: dist,
  // Never reached once the page is defined, and an install must not need it.
  external: ['esbuild'],
  define: { __REPORT_CLIENT__: JSON.stringify(await buildClient()) },
  logLevel: 'warning',
});

const tsc = spawnSync(process.execPath, [path.join(packageDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
  cwd: packageDir,
  stdio: 'inherit',
});
if (tsc.status !== 0) throw new Error('Writing the type declarations failed');
for (const file of readdirSync(dist).filter((name) => name.endsWith('.d.ts'))) rewriteDeclarationPaths(path.join(dist, file));

// The page carries the Archivo font, and its licence travels with every copy.
copyFileSync(path.join(packageDir, 'src', 'client', 'Archivo-OFL.txt'), path.join(dist, 'Archivo-OFL.txt'));
