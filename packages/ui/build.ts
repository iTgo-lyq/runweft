// One front-end build for every consumer of the UI library: Bun bundles the TSX, Tailwind scans the sources and
// emits a static stylesheet. Nothing is fetched at runtime and nothing depends on Vite or PostCSS.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

export const UI_ROOT = import.meta.dir;

export type FrontendBuild = { js: string; css: string };

/** `iife` suits inline scripts in sandboxed previews, which cannot load modules. */
export async function buildFrontend({ entry, css, minify = true, format = 'esm' }: { entry: string; css: string; minify?: boolean; format?: 'esm' | 'iife' }): Promise<FrontendBuild> {
  const result = await Bun.build({
    entrypoints: [entry], target: 'browser', format, minify, sourcemap: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
    tsconfig: resolve(UI_ROOT, '../../tsconfig.json'),
  });
  if (!result.success) throw new Error(`Front-end bundle failed:\n${result.logs.map(log => String(log)).join('\n')}`);
  const script = result.outputs.find(output => output.kind === 'entry-point');
  if (!script || result.outputs.length !== 1) throw new Error('Front-end bundle must produce exactly one script; import CSS through the stylesheet entry instead.');
  return { js: await script.text(), css: await buildStylesheet(css, minify) };
}

export async function buildStylesheet(path: string, minify = true) {
  const file = resolve(path);
  const compiler = await compile(readFileSync(file, 'utf8'), { base: dirname(file), from: file, onDependency() {} });
  // Explicit @source entries plus the stylesheet's own folder, unless the stylesheet opts out with source(none).
  const sources = [...compiler.sources];
  if (compiler.root !== 'none') sources.push({ ...(compiler.root ?? { base: dirname(file), pattern: '**/*' }), negated: false });
  const scanner = new Scanner({ sources });
  const css = compiler.build(scanner.scan());
  return minify ? optimize(css, { minify: true }).code : css;
}
