import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/website');
const types = { '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.sha256': 'text/plain; charset=utf-8', '.tgz': 'application/gzip' };

export async function serveSite({ root = defaultRoot, port = 4173, mount = '/' } = {}) {
  const base = await realpath(root);
  if (!mount.startsWith('/') || !mount.endsWith('/')) throw new Error('预览路径必须以 / 开始和结束。');
  const server = createServer(async (request, response) => {
    const fail = (status, message) => { response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); response.end(message); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return fail(405, '只支持 GET / HEAD。'); }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(mount)) return fail(404, '页面不存在。');
      let target = resolve(base, pathname.slice(mount.length) || 'index.html');
      if (target !== base && !target.startsWith(base + sep)) return fail(404, '页面不存在。');
      if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
      target = await realpath(target);
      if (!target.startsWith(base + sep)) return fail(404, '页面不存在。');
      const info = await stat(target);
      if (!info.isFile()) return fail(404, '页面不存在。');
      response.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream', 'content-length': info.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(target);
      response.on('close', () => stream.destroy());
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof URIError) return fail(404, '页面不存在。');
      console.error(`预览读取失败：${error.message}`);
      if (!response.headersSent) fail(500, '无法读取站点文件，请重新构建官网。'); else response.destroy();
    }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return { server, url: `http://127.0.0.1:${server.address().port}${mount}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = process.argv[2] === undefined ? 4173 : Number(process.argv[2]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口必须在 0–65535 之间。');
    const { server, url } = await serveSite({ port });
    console.log(`Runweft 官网预览：${url}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  } catch (error) { console.error(`无法启动官网预览：${error.message}\n先运行 node website/build.mjs。`); process.exitCode = 1; }
}
