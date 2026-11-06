/** Set when the npm package or a suite's own runner is built, which ships the page already bundled and no bundler. */
declare const __REPORT_CLIENT__: string | undefined;

/**
 * Bundles the report page, with its stylesheet and font, into one script. A report is one file that opens with no
 * server and no network, so nothing it needs can stay beside it.
 */
export async function buildClient(): Promise<string> {
  if (typeof __REPORT_CLIENT__ === 'string') return __REPORT_CLIENT__;
  // Imported here and not at the top, because what ships the page built has no esbuild.
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [new URL('./client/main.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    target: 'es2022',
    loader: { '.css': 'text', '.woff2': 'base64' },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('Bundling the report page produced no file');
  return output.text;
}
