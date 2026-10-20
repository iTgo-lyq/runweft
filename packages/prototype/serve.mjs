import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxCsp } from '../../.agents/skills/spec-trail/prototype/scripts/html.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const entries = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8')).entries.map(e => e.id);
const port = Number(process.argv[2] || 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535');
await readFile(join(root, 'dist/tasks/index.html'));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.writeHead(302, { Location: '/tasks/index.html' }); return res.end(); }
  const match = pathname.match(/^\/([a-z-]+)\/index\.html$/);
  if (!match || !entries.includes(match[1])) { res.writeHead(404); return res.end('Not found'); }
  try {
    const html = await readFile(join(root, 'dist', match[1], 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': sandboxCsp, 'Cache-Control': 'no-store' });
    res.end(html);
  } catch { res.writeHead(500); res.end('Build the prototype first'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Runweft prototype: http://127.0.0.1:${port}/tasks/index.html`));
