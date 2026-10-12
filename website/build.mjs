import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function buildSite({ projectDirectory = repository, outputDirectory = join(projectDirectory, 'dist/website') } = {}) {
  const { version } = JSON.parse(await readFile(join(projectDirectory, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('官网 npm 安装版本无效。');
  const release = { version, installation: 'npm', package: 'runweft', registry: 'https://registry.npmjs.org/' };
  const manual = await readFile(join(projectDirectory, 'docs/usage.md'), 'utf8');
  const replacements = {
    VERSION: version,
    NPM_INSTALL: escape(`npm install -g runweft@${version} --registry=${release.registry} --include=optional &&\nrunweft --version`),
    MANUAL_TEXT: escape(manual),
  };
  await mkdir(dirname(outputDirectory), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputDirectory), '.website-'));
  const previous = `${staging}-previous`;
  let previousMoved = false;
  try {
    await cp(join(projectDirectory, 'website/assets'), join(staging, 'assets'), { recursive: true });
    for (const file of ['index.html', 'guide.html', 'manual.html']) {
      const template = await readFile(join(projectDirectory, 'website', file), 'utf8');
      const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
        if (!(name in replacements)) throw new Error(`未知页面占位符：${name}`);
        return replacements[name];
      });
      await writeFile(join(staging, file), html);
    }
    await writeFile(join(staging, 'release.json'), JSON.stringify(release, null, 2) + '\n');
    try { await rename(outputDirectory, previous); previousMoved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, outputDirectory); } catch (error) { if (previousMoved) await rename(previous, outputDirectory); previousMoved = false; throw error; }
    if (previousMoved) await rm(previous, { recursive: true });
    return { directory: outputDirectory, ...release };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildSite(), null, 2)); }
  catch (error) { console.error(`官网构建失败：${error.message}\n请检查 package.json、website/ 和 docs/usage.md。`); process.exitCode = 1; }
}
