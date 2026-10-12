import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
// IIFE has no module/CORS or origin requirements inside sandbox="allow-scripts".
const result = await Bun.build({ entrypoints: [join(root, 'src/app.js')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Prototype build failed');
const js = (await result.outputs[0].text()).replaceAll('</script', '<\\/script');
const css = await readFile(join(root, 'src/style.css'), 'utf8');
const shell = await readFile(join(root, 'src/shell.html'), 'utf8');
const { htmlIssues } = await import('../../.agents/skills/spec-trail/prototype/scripts/html.mjs');
await rm(join(root, 'dist'), { recursive: true, force: true });
for (const entry of manifest.entries) {
  const html = shell.replace('__ENTRY__', entry.id).replace('<!-- STYLE -->', `<style>${css}</style>`).replace('<!-- SCRIPT -->', `<script>${js}</script>`);
  const issues = htmlIssues(html); if (issues.length) throw Error(`${entry.id}: ${issues.join('; ')}`);
  await mkdir(join(root, 'dist', entry.id), { recursive: true });
  await writeFile(join(root, 'dist', entry.id, 'index.html'), html);
}
console.log(`Built ${manifest.entries.length} self-contained Hub previews.`);
