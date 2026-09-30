import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installationCommands } from './assets/install.js';

const siteSource = dirname(fileURLToPath(import.meta.url));
const repository = resolve(siteSource, '..');
const platformInfo = [
  { id: 'darwin-arm64', label: 'macOS Apple Silicon', note: 'Mac 产物未签名、未公证；实机验证由使用者完成。', scope: '已构建；未实机验证' },
  { id: 'darwin-x64', label: 'macOS Intel', note: 'Mac 产物未签名、未公证；实机验证由使用者完成。', scope: '已构建；未实机验证' },
  { id: 'linux-x64', label: 'Linux x64', note: 'glibc Linux；已完成真实安装、原生协作与浏览器验收。', scope: '原生安装与协作通过' },
  { id: 'linux-arm64', label: 'Linux arm64', note: 'glibc Linux；已通过 QEMU CLI / 配置验证，未作原生完整协作验证。', scope: 'QEMU CLI / 配置通过' },
];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function hashes(path) {
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { sha256.update(chunk); sha512.update(chunk); bytes += chunk.length; }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('base64'), bytes };
}

export async function buildSite({ packagesDirectory = join(repository, 'dist/packages'), outputDirectory = join(repository, 'dist/website') } = {}) {
  const index = JSON.parse(await readFile(join(packagesDirectory, 'index.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(index.version)) throw new Error('发行版本无效；请先构建完整发行包。');
  const checksums = new Map((await readFile(join(packagesDirectory, 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => {
    const [hash, filename] = line.split(/\s{2}/);
    return [filename, hash];
  }));
  if ((await hashes(join(packagesDirectory, 'index.json'))).sha256 !== checksums.get('index.json')) throw new Error('发行 index.json 校验失败。');
  await mkdir(dirname(outputDirectory), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputDirectory), '.website-'));
  const previous = `${staging}-previous`;
  let previousMoved = false;
  try {
    await cp(join(siteSource, 'assets'), join(staging, 'assets'), { recursive: true });
    await mkdir(join(staging, 'downloads'));
    const release = { version: index.version, platforms: [] };
    for (const info of platformInfo) {
      const name = `runweft-${info.id}`;
      const entry = index.packages.find(item => item.name === name);
      const filename = `${name}-${index.version}.tgz`;
      if (!entry || entry.version !== index.version || entry.tarball !== `tarballs/${filename}`) throw new Error(`缺少一致版本的平台包：${name}。`);
      const source = join(packagesDirectory, entry.tarball);
      const computed = await hashes(source);
      if (computed.sha512 !== entry.sha512 || computed.sha256 !== checksums.get(entry.tarball)) throw new Error(`平台包校验失败：${filename}。请重新构建发行包。`);
      await cp(source, join(staging, 'downloads', filename));
      await writeFile(join(staging, 'downloads', `${filename}.sha256`), `${computed.sha256}  ${filename}\n`);
      release.platforms.push({ ...info, filename, sha256: computed.sha256, bytes: computed.bytes, size: `${(computed.bytes / 1024 / 1024).toFixed(1)} MiB` });
    }
    const first = release.platforms[0];
    const manual = await readFile(join(repository, 'docs/usage.md'), 'utf8');
    await writeFile(join(staging, 'downloads/usage.md'), manual);
    await writeFile(join(staging, 'downloads/SHA256SUMS'), release.platforms.map(item => `${item.sha256}  ${item.filename}\n`).join(''));
    const replacements = {
      VERSION: index.version,
      DEFAULT_ARCHIVE: first.filename,
      DEFAULT_SIZE: first.size,
      DEFAULT_INSTALL: escape(installationCommands(first.id, index.version, first.sha256)),
      RELEASE_DATA: JSON.stringify(release).replaceAll('<', '\\u003c'),
      MANUAL_TEXT: escape(manual),
      NO_SCRIPT_INSTALLS: release.platforms.map(item => `<details class="guide-details"><summary>${escape(item.label)} 安装命令</summary><pre tabindex="0"><code>${escape(installationCommands(item.id, index.version, item.sha256))}</code></pre></details>`).join('\n'),
      DOWNLOAD_ROWS: release.platforms.map(item => `<tr><td>${escape(item.label)}</td><td><a href="downloads/${item.filename}" download>${item.filename}</a><small><a href="downloads/${item.filename}.sha256" download>SHA-256 校验文件</a></small></td><td>${item.size}</td><td>${escape(item.scope)}</td></tr>`).join('\n'),
    };
    for (const file of ['index.html', 'guide.html', 'manual.html']) {
      const template = await readFile(join(siteSource, file), 'utf8');
      const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
        if (!(name in replacements)) throw new Error(`未知页面占位符：${name}`);
        return replacements[name];
      });
      await writeFile(join(staging, file), html);
    }
    await writeFile(join(staging, 'release.json'), JSON.stringify({ ...release, source: index.source, hapi: index.hapi }, null, 2) + '\n');
    try { await rename(outputDirectory, previous); previousMoved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, outputDirectory); } catch (error) { if (previousMoved) await rename(previous, outputDirectory); previousMoved = false; throw error; }
    if (previousMoved) await rm(previous, { recursive: true });
    return { directory: outputDirectory, version: index.version, platforms: release.platforms.length };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildSite(), null, 2)); }
  catch (error) { console.error(`官网构建失败：${error.message}\n先运行 bun run package，保留完整 dist/packages，再运行 node website/build.mjs。`); process.exitCode = 1; }
}
