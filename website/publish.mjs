import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareReleaseVersions, packageNames, registry, releaseChannel } from '../scripts/npm-publish.mjs';

const siteFiles = {
  'index.html': 'text/html', 'guide.html': 'text/html', 'manual.html': 'text/html',
  'release.json': 'application/json', 'assets/icons.svg': 'image/svg+xml',
  'assets/mark.svg': 'image/svg+xml', 'assets/style.css': 'text/css',
  'assets/hapi-session.webp': 'image/webp', 'assets/hapi-code.webp': 'image/webp',
  'assets/site.js': ['text/javascript', 'application/javascript'],
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const noDownloads = html => assert(!/<a\b[^>]*\bdownload(?:\s|=|>)/i.test(html)
  && !/(?:href|src)=["'][^"']*(?:\/downloads\/|\.(?:tgz|tar\.gz|zip|sha256)(?:["'?#]))/i.test(html), '官网不能提供包下载。');

export function siteEligibility(env, version) {
  if (env.RELEASE_PARALLEL === 'true') {
    assert(env.RELEASE_VERSION, '并行官网必须绑定发行版本。');
    assert.match(env.RELEASE_RUN_ID ?? '', /^[1-9]\d*$/, '并行官网必须绑定发行 run。');
    assert.match(env.RELEASE_ATTEMPT ?? '', /^[1-9]\d*$/, '并行官网必须绑定发行 attempt。');
  }
  if (env.RELEASE_VERSION) {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(env.GITHUB_REF, 'refs/heads/main', '发行接续只能部署 main。');
    assert.equal(version, env.RELEASE_VERSION, 'main 版本已变化；不要用旧发行覆盖新官网。');
  }
  if (releaseChannel(version) === 'latest') return true;
  assert(['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_REF_TYPE === 'branch'
    && env.GITHUB_REF_NAME?.startsWith('codex/'), 'Beta 官网只允许开发分支跳过；main 和 PR 必须使用稳定版本。');
  return false;
}

export async function checkPublication(site, env, { fetchImpl = fetch } = {}) {
  assert(siteEligibility(env, site.release.version), '官网仅接受稳定版本。');
  if (env.RELEASE_PARALLEL === 'true') return { ready: true, packages: [], npmValidation: 'deferred-to-release',
    releaseRunId: env.RELEASE_RUN_ID, releaseAttempt: env.RELEASE_ATTEMPT };
  const publication = await publicationReady(site.release, { allowPending: env.GITHUB_EVENT_NAME === 'push' && !env.RELEASE_VERSION, fetchImpl });
  return { ...publication, ...(publication.ready ? { packages: await checkNpmRelease(site.release, fetchImpl), npmValidation: 'passed' } : {}) };
}

export async function publicationReady(release, { allowPending = false, fetchImpl = fetch } = {}) {
  const pending = [];
  await Promise.all(packageNames.map(async name => {
    const response = await request(`${registry}-/package/${name}/dist-tags`, { headers: { 'cache-control': 'no-cache' } }, fetchImpl);
    assert([200, 404].includes(response.status), `${name} dist-tags HTTP ${response.status}`);
    const tags = response.status === 404 ? {} : await response.json();
    if (tags.latest !== release.version) {
      if (tags.latest) assert(compareReleaseVersions(tags.latest, release.version) < 0, '公开 latest 已领先本次官网；从最新 main 处理。');
      pending.push(name);
    }
  }));
  if (pending.length) assert(allowPending, 'npm 尚未晋级；仅恢复已晋级版本的官网。');
  return { ready: pending.length === 0, pending };
}

export function deploymentTarget(env) {
  const branch = env.GITHUB_REF_NAME;
  if (!['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_REF_TYPE !== 'branch') return { mode: 'check' };
  if (branch !== 'main' && !branch?.startsWith('codex/')) return { mode: 'check' };
  assert(/^[A-Za-z0-9._/-]+$/.test(branch), '部署分支含不支持的字符。');
  return { mode: branch === 'main' ? 'production' : 'preview', branch };
}

export async function validateSite(directory) {
  const files = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      assert(!entry.name.startsWith('.') && !entry.isSymbolicLink(), `静态产物含隐藏文件或链接：${name}`);
      if (entry.isDirectory()) { assert.equal(name, 'assets', `静态产物含未知目录：${name}`); await walk(name); }
      else { assert(entry.isFile() && name in siteFiles, `静态产物含未知文件：${name}`); files.push(name); }
    }
  }
  assert((await lstat(directory)).isDirectory(), '静态目录不可用。');
  await walk();
  assert.deepEqual(files.sort(), Object.keys(siteFiles).sort(), '静态产物文件集合不完整。');
  const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
  assert.deepEqual(Object.keys(release).sort(), ['installation', 'package', 'registry', 'version']);
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(release, { version: release.version, installation: 'npm', package: 'runweft', registry });
  const entries = [];
  for (const name of files) {
    const bytes = await readFile(join(directory, name));
    assert(bytes.length < 25 * 1024 * 1024, `Pages 单文件过大：${name}`);
    if (name.endsWith('.html')) {
      noDownloads(bytes.toString('utf8'));
      if (name !== 'manual.html') assert(bytes.includes(`npm install -g runweft@${release.version}`), `${name} 安装版本不匹配。`);
    }
    entries.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  return { release, files: entries, bytes: entries.reduce((sum, file) => sum + file.bytes, 0) };
}

async function request(url, options, fetchImpl, timeoutMs = 30_000) {
  try { return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))) }); }
  catch (error) {
    const code = error.cause?.code ?? error.code ?? error.name;
    const detail = /^[A-Z][A-Z0-9_]{0,79}$/.test(code ?? '') ? `（${code}）` : '';
    throw new Error(`网络请求失败或超时${detail}；请检查服务状态和访问条件。`);
  }
}

export async function checkNpmRelease(release, fetchImpl = fetch) {
  const records = [];
  for (const name of packageNames) {
    const tagResponse = await request(`${registry}-/package/${name}/dist-tags`, { headers: { 'cache-control': 'no-cache' } }, fetchImpl);
    assert.equal(tagResponse.status, 200, `${name} dist-tags HTTP ${tagResponse.status}；先完成 npm 发布。`);
    assert.equal((await tagResponse.json()).latest, release.version, `${name} latest 尚未晋级 ${release.version}；先完成四平台验收与 npm 晋级。`);
    const response = await request(`${registry}${name}/${release.version}`, { headers: { 'cache-control': 'no-cache' } }, fetchImpl);
    assert.equal(response.status, 200, `${name}@${release.version} 尚未公开或 npm HTTP ${response.status}；先完成 npm 发布。`);
    const manifest = await response.json();
    assert.equal(manifest.name, name, `${name} registry 包名不一致。`);
    assert.equal(manifest.version, release.version, `${name} registry 版本不一致。`);
    assert.match(manifest.dist?.integrity ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/, `${name} 缺少完整 SHA-512。`);
    const tarball = new URL(manifest.dist?.tarball ?? 'about:blank');
    assert(tarball.href.startsWith(`${registry}${name}/-/`) && !tarball.username && !tarball.password, `${name} tarball 不是公共 npm 地址。`);
    if (name === 'runweft') assert.deepEqual(manifest.optionalDependencies,
      Object.fromEntries(packageNames.filter(item => item !== 'runweft').map(item => [item, release.version])), '主包平台依赖版本不一致。');
    const archive = await request(tarball.href, { method: 'HEAD' }, fetchImpl);
    assert.equal(archive.status, 200, `${name} tarball 不可访问：HTTP ${archive.status}`);
    records.push({ name, version: manifest.version, integrity: manifest.dist.integrity });
  }
  return records;
}

export async function assertCurrentProduction(env, fetchImpl = fetch) {
  if (deploymentTarget(env).mode !== 'production') return;
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert(env.GH_TOKEN, '生产部署缺少 GitHub 只读 token。');
  const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`,
    { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' } }, fetchImpl);
  assert.equal(response.status, 200, `main 当前提交查询失败：HTTP ${response.status}`);
  assert.equal((await response.json()).object?.sha, env.GITHUB_SHA, '此 run 不是 main 最新提交；请从最新 main 运行，避免覆盖新官网。');
}

export async function ensurePagesProject({ accountId, apiToken, projectName }, fetchImpl = fetch) {
  assert.match(accountId ?? '', /^[a-f0-9]{32}$/i, 'CLOUDFLARE_ACCOUNT_ID 应为账户的 32 位 ID。');
  assert.match(projectName ?? '', /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$|^[a-z0-9]$/, 'Pages 项目名应为小写字母、数字或连字符。');
  assert(apiToken, '缺少 CLOUDFLARE_API_TOKEN。');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  let response = await request(`${url}/${projectName}`, { headers }, fetchImpl);
  let created = false;
  if (response.status === 404) {
    created = true;
    try {
      response = await request(url, { method: 'POST', headers, body: JSON.stringify({ name: projectName, production_branch: 'main' }) }, fetchImpl);
    } catch { throw new Error('Pages 项目创建结果未知；先检查 Cloudflare 控制台，再重新运行。'); }
  }
  assert.equal(response.status, 200, `Pages 项目${created ? '创建' : '查询'}失败：HTTP ${response.status}；检查账户 ID 和 Pages Edit 权限。`);
  const body = await response.json();
  assert(body.success === true && body.result, 'Pages API 未确认成功；请检查控制台与账户权限。');
  const project = body.result;
  assert.equal(project.name, projectName, 'Pages API 项目名不匹配。');
  assert.equal(project.production_branch, 'main', '已有 Pages 项目的生产分支不是 main；请指定专用项目，不会自动修改。');
  assert(!project.source, '已有 Pages 项目连接了 Git；请指定 Direct Upload 项目。');
  assert.match(project.subdomain ?? '', /^[a-z0-9-]+\.pages\.dev$/, 'Pages API 未返回有效项目子域。');
  return { project: project.name, subdomain: project.subdomain, created };
}

export function deploymentReference({ url, subdomain, mode, pagesEnvironment }) {
  assert.equal(pagesEnvironment, mode, 'Pages 实际生产/预览环境不匹配。');
  const deployment = new URL(url);
  const validHost = host => host === subdomain || host.endsWith(`.${subdomain}`);
  assert(deployment.protocol === 'https:' && validHost(deployment.hostname) && !deployment.username && !deployment.password
    && deployment.pathname === '/' && !deployment.search && !deployment.hash, '部署 URL 必须来自当前 Pages 项目。');
  return { deployment, validHost };
}

export async function verifyDeployment(target, {
  fetchImpl = fetch, pause = ms => new Promise(done => setTimeout(done, ms)), attempts = 36,
  now = Date.now, timeoutMs = 180_000, record = () => {},
} = {}) {
  const { deployment, validHost } = deploymentReference(target);
  const { mode, site } = target;
  const started = now(), deadline = started + timeoutMs;
  const retry = async () => {
    assert(now() < deadline, 'Pages 在线校验传播等待超过三分钟；请检查实际部署，不会重新上传。');
    await pause(Math.min(5000, deadline - now()));
  };
  for (const file of site.files) {
    let confirmed = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      assert(now() < deadline, 'Pages 在线校验传播等待超过三分钟；请检查实际部署，不会重新上传。');
      let response;
      try { response = await request(new URL(file.name, deployment).href, { headers: { 'cache-control': 'no-cache' } }, fetchImpl, Math.min(30_000, deadline - now())); }
      catch (error) { if (attempt + 1 === attempts) throw error; await retry(); continue; }
      assert(!response.url || validHost(new URL(response.url).hostname), 'Pages 转到了项目外地址；请检查 Access 保护。');
      if (response.status === 404 || response.status >= 500) { if (attempt + 1 < attempts) { await retry(); continue; } }
      assert.equal(response.status, 200, `${file.name} 在线校验失败：HTTP ${response.status}`);
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      assert([siteFiles[file.name]].flat().includes(mime), `${file.name} MIME 不匹配：${mime}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = digest(bytes), matched = sha256 === file.sha256;
      record({ file: file.name, attempt: attempt + 1, status: response.status, host: new URL(response.url || deployment).hostname,
        sha256, expectedSha256: file.sha256, matched, elapsedMs: now() - started });
      if (!matched && attempt + 1 < attempts && now() < deadline) { await retry(); continue; }
      assert.equal(sha256, file.sha256, `${file.name} 在线内容与本次构建不一致。`);
      assert(now() <= deadline, 'Pages 在线校验超过传播预算。');
      confirmed = true;
      break;
    }
    assert(confirmed, `${file.name} Pages 传播等待超时。`);
  }
  return { success: true, url: deployment.href, mode, version: site.release.version, files: site.files };
}

async function save(name, value) {
  await mkdir('.dev-smoke/website-pages', { recursive: true });
  await writeFile(`.dev-smoke/website-pages/${name}.json`, JSON.stringify(value, null, 2) + '\n');
}
async function summary(text) { if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); }
async function outputs(values) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function main() {
  const env = process.env;
  const directory = resolve('dist/website');
  switch (process.argv[2]) {
    case 'eligibility': {
      const version = JSON.parse(await readFile('package.json', 'utf8')).version;
      const build = siteEligibility(env, version);
      await outputs({ build });
      await save('eligibility', { version, build, sourceRevision: env.GITHUB_SHA });
      if (!build) await summary(`开发分支版本 ${version} 为 Beta：部署检查已执行，官网保持稳定版本，跳过构建与上传。`);
      break;
    }
    case 'check': {
      const site = await validateSite(directory);
      const publication = await checkPublication(site, env);
      await outputs({ ready: publication.ready });
      if (!publication.ready) {
        await save('check', { success: true, deployed: false, waitingFor: 'npm-promotion', ...site, ...publication });
        await summary(`静态检查通过；npm ${site.release.version} 尚未晋级，官网等待发布。`);
        break;
      }
      await save('check', { success: true, sourceRevision: env.GITHUB_SHA, ...site, ...publication });
      await summary(publication.npmValidation === 'deferred-to-release'
        ? `官网静态检查通过：与 npm ${site.release.version} 并行发布，允许短暂不可安装；npm 结果由发行流程单独核验并汇合。`
        : `官网检查通过：npm ${site.release.version} 五包公开、tarball 可访问；${site.files.length} 个静态文件，${site.bytes} bytes。`);
      console.log(`官网 ${site.release.version} 检查通过：${publication.npmValidation}。`);
      break;
    }
    case 'prepare': {
      const target = deploymentTarget(env);
      if (target.mode === 'check') { await outputs({ deploy: false }); await summary('此事件/分支仅检查，未部署。'); break; }
      const missing = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'].filter(key => !env[key]);
      if (missing.length) {
        await outputs({ deploy: false });
        await save('prepare', { deployed: false, ...target, missing });
        await summary(`**未部署**：缺少 GitHub Secrets ${missing.join('、')}。`);
        if (target.mode === 'production' || env.GITHUB_EVENT_NAME === 'workflow_dispatch') throw new Error('请先配置 Cloudflare Secrets，再运行部署。');
        console.log(`::warning::官网未部署：缺少 ${missing.join('、')}`);
        break;
      }
      await assertCurrentProduction(env);
      if (env.RELEASE_VERSION) assert.equal((await validateSite(directory)).release.version, env.RELEASE_VERSION);
      const project = await ensurePagesProject({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN, projectName: env.CLOUDFLARE_PAGES_PROJECT || 'runweft' });
      await validateSite(directory);
      const toolDirectory = join(env.RUNNER_TEMP, 'runweft-pages-tools');
      await mkdir(toolDirectory, { recursive: true });
      await writeFile(join(toolDirectory, 'package.json'), JSON.stringify({ name: 'runweft-pages-tools', private: true }));
      await save('prepare', { deployed: false, ...target, ...project });
      await outputs({ deploy: true, ...target, ...project, tool_directory: toolDirectory, site_directory: directory });
      break;
    }
    case 'verify': {
      const site = await validateSite(directory);
      const prepared = JSON.parse(await readFile('.dev-smoke/website-pages/prepare.json', 'utf8'));
      const target = { url: env.PAGES_DEPLOYMENT_URL, subdomain: prepared.subdomain,
        mode: prepared.mode, pagesEnvironment: env.PAGES_ENVIRONMENT, site };
      const { deployment } = deploymentReference(target);
      await save('deployment', { success: false, uploaded: true, url: deployment.href, mode: prepared.mode,
        pagesEnvironment: env.PAGES_ENVIRONMENT, branch: prepared.branch, sourceRevision: env.GITHUB_SHA,
        verification: 'pending' });
      await summary(`Pages 已上传 ${prepared.mode}：[${deployment.href}](${deployment.href})，正在校验在线内容。`);
      const options = { record: value => console.log('RUNWEFT_WEBSITE_READ=' + JSON.stringify(value)) };
      const result = await verifyDeployment(target, options);
      let production;
      if (prepared.mode === 'production') production = await verifyDeployment({ ...target, url: `https://${prepared.subdomain}/` }, options);
      await save('deployment', { ...result, production, branch: prepared.branch, sourceRevision: env.GITHUB_SHA });
      await summary(`**已部署并验证 ${result.mode}**：[${result.url}](${result.url})，npm ${result.version}，分支 ${prepared.branch}。`);
      console.log(`Pages ${result.mode} 在线校验通过：${result.url}`);
      break;
    }
    case 'current': await assertCurrentProduction(env); break;
    default: throw new Error('用法：node website/publish.mjs eligibility|check|prepare|verify');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`官网发布失败：${error.message}`); process.exitCode = 1; });
}
