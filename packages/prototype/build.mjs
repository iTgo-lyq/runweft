import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
// --git-preview also writes the self-contained snapshots used by SpecTrail's Git delivery.
const gitPreview = process.argv.includes('--git-preview');
// The UI library's build: React pages bundled as an IIFE, which has no module/CORS or origin requirements inside
// sandbox="allow-scripts", and Tailwind CSS generated from the library and these pages.
const { buildFrontend } = await import('../ui/build.ts');
const built = await buildFrontend({ entry: join(root, 'src/main.tsx'), css: join(root, 'src/app.css'), format: 'iife' });
const js = built.js.replaceAll('</script', '<\\/script');
const css = built.css.replaceAll('</style', '<\\/style');
const shell = await readFile(join(root, 'src/shell.html'), 'utf8');
const { htmlIssues } = await import('../../.agents/skills/spec-trail/prototype/scripts/html.mjs');
await rm(join(root, 'dist'), { recursive: true, force: true });
for (const entry of manifest.entries) {
  // Every entry is the same app; the entry id only chooses the first screen.
  const html = shell.replace('__ENTRY__', entry.id).replace('<!-- STYLE -->', () => `<style>${css}</style>`).replace('<!-- SCRIPT -->', () => `<script>${js}</script>`);
  const issues = htmlIssues(html); if (issues.length) throw Error(`${entry.id}: ${issues.join('; ')}`);
  for (const dir of gitPreview ? ['dist', 'preview'] : ['dist']) {
    await mkdir(join(root, dir, entry.id), { recursive: true });
    await writeFile(join(root, dir, entry.id, 'index.html'), html);
  }
}
console.log(`Built ${manifest.entries.length} self-contained Hub previews${gitPreview ? ' and Git snapshots' : ''}.`);
