import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildSite } from './build.mjs';
import { assertCurrentProduction, checkNpmRelease, deploymentTarget, ensurePagesProject, validateSite, verifyDeployment } from './publish.mjs';
import { packageNames, registry } from '../scripts/npm-publish.mjs';

await mkdir('.dev-smoke', { recursive: true });
const temporary = await mkdtemp(resolve('.dev-smoke/website-pages-test-'));
const directory = join(temporary, 'site');
await buildSite({ outputDirectory: directory });
const site = await validateSite(directory);
after(() => rm(temporary, { recursive: true, force: true }));
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const integrity = 'sha512-' + createHash('sha512').update('fixture').digest('base64');
const manifest = name => ({ name, version: site.release.version,
  dist: { integrity, tarball: `${registry}${name}/-/${name}-${site.release.version}.tgz` },
  ...(name === 'runweft' ? { optionalDependencies: Object.fromEntries(packageNames.slice(0, -1).map(item => [item, site.release.version])) } : {}),
});
const account = { accountId: 'a'.repeat(32), apiToken: 'fixture-token', projectName: 'runweft' };
const project = { name: 'runweft', production_branch: 'main', subdomain: 'runweft-test.pages.dev' };

test('production/preview only for allowed branch push or manual; PR/tags/other refs check only', () => {
  assert.deepEqual(deploymentTarget(env), { mode: 'production', branch: 'main' });
  assert.deepEqual(deploymentTarget({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'codex/cli-foundation' }), { mode: 'preview', branch: 'codex/cli-foundation' });
  for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF_TYPE: 'tag' }, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'tag' }, { GITHUB_REF_NAME: 'feature/test' }, { GITHUB_EVENT_NAME: 'workflow_run' }]) {
    assert.deepEqual(deploymentTarget({ ...env, ...change }), { mode: 'check' });
  }
  assert.throws(() => deploymentTarget({ ...env, GITHUB_REF_NAME: 'codex/x;echo-token' }), /字符/);
});

test('real build has exactly static files and same npm version; no package archives', async () => {
  assert.equal(site.files.length, 8);
  assert.equal(site.release.installation, 'npm');
  const bad = join(directory, 'package.tgz');
  await writeFile(bad, 'archive');
  try { await assert.rejects(validateSite(directory), /未知文件/); } finally { await rm(bad); }
  const link = join(directory, 'linked');
  await symlink('index.html', link);
  try { await assert.rejects(validateSite(directory), /链接/); } finally { await rm(link); }
});

test('static metadata and download anchors are rejected before uploading', async () => {
  const metadata = join(directory, 'release.json');
  const original = await readFile(metadata);
  await writeFile(metadata, JSON.stringify({ ...site.release, source: { token: 'fixture' } }));
  try { await assert.rejects(validateSite(directory)); } finally { await writeFile(metadata, original); }
  const html = join(directory, 'index.html');
  const source = await readFile(html);
  await writeFile(html, source + '<a download href="/downloads/runweft.tgz">Download</a>');
  try { await assert.rejects(validateSite(directory), /下载/); } finally { await writeFile(html, source); }
});

test('five public exact versions and tarball HEAD are checked without downloading binaries', async () => {
  const requests = [];
  const result = await checkNpmRelease(site.release, async (url, options) => {
    requests.push({ url, method: options.method });
    if (options.method === 'HEAD') return new Response(null, { status: 200 });
    const name = new URL(url).pathname.split('/')[1];
    assert.equal(options.headers['cache-control'], 'no-cache');
    return json(manifest(name));
  });
  assert.deepEqual(result.map(item => item.name), packageNames);
  assert.equal(requests.filter(item => item.method === 'HEAD').length, 5);
  assert.equal(requests.length, 10);
});

test('npm missing, wrong identity, integrity, dependency and tarball failures stop checking', async () => {
  await assert.rejects(checkNpmRelease(site.release, async () => json({}, 404)), /先完成 npm 发布/);
  await assert.rejects(checkNpmRelease(site.release, async () => { throw new Error('fixture network'); }), /网络/);
  for (const modify of [m => { m.name = 'wrong'; }, m => { m.version = '0.0.0'; }, m => { m.dist.integrity = 'sha512-incomplete'; }, m => { m.dist.tarball = 'https://private.invalid/package.tgz'; }]) {
    await assert.rejects(checkNpmRelease(site.release, async () => { const m = manifest(packageNames[0]); modify(m); return json(m); }));
  }
  await assert.rejects(checkNpmRelease(site.release, async (url, options) => {
    if (options.method === 'HEAD') return json({}, 200);
    const m = manifest(new URL(url).pathname.split('/')[1]);
    if (m.name === 'runweft') m.optionalDependencies['runweft-linux-x64'] = '0.0.0';
    return json(m);
  }), /平台依赖/);
  await assert.rejects(checkNpmRelease(site.release, async (url, options) => options.method === 'HEAD' ? json({}, 404) : json(manifest(packageNames[0]))), /tarball 不可访问/);
});

test('existing Direct Upload project is read only; explicit 404 creates with main production', async () => {
  const existing = await ensurePagesProject(account, async (_, options) => {
    assert.equal(options.method, undefined);
    assert.equal(options.headers.authorization, 'Bearer fixture-token');
    return json({ success: true, result: project });
  });
  assert.equal(existing.created, false);
  const calls = [];
  const created = await ensurePagesProject(account, async (url, options) => {
    calls.push(url);
    if (!options.method) return json({ success: false }, 404);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { name: 'runweft', production_branch: 'main' });
    return json({ success: true, result: project });
  });
  assert.equal(created.created, true);
  assert.equal(calls.length, 2);
});

test('Pages permission failures, Git source and non-main project never mutate settings', async () => {
  for (const status of [401, 403, 500]) {
    let count = 0;
    await assert.rejects(ensurePagesProject(account, async (_, options) => { count++; assert.equal(options.method, undefined); return json({}, status); }), /账户 ID/);
    assert.equal(count, 1);
  }
  for (const fields of [{ production_branch: 'legacy' }, { source: { type: 'github' } }]) {
    await assert.rejects(ensurePagesProject(account, async (_, options) => { assert.equal(options.method, undefined); return json({ success: true, result: { ...project, ...fields } }); }));
  }
  let count = 0;
  await assert.rejects(ensurePagesProject(account, async () => { if (++count === 1) return json({}, 404); throw new Error('connection lost'); }), /结果未知/);
  assert.equal(count, 2);
});

test('production rejects stale run; preview requires no GitHub API request', async () => {
  const production = { ...env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), GH_TOKEN: 'fixture-token' };
  await assertCurrentProduction(production, async () => json({ object: { sha: production.GITHUB_SHA } }));
  await assert.rejects(assertCurrentProduction(production, async () => json({ object: { sha: 'b'.repeat(40) } })), /最新提交/);
  await assertCurrentProduction({ ...production, GITHUB_REF_NAME: 'codex/test' }, () => { throw new Error('unexpected request'); });
});

test('missing secrets explicitly skip preview, fail production, and never output upload authorization', async () => {
  for (const branch of ['codex/test', 'main']) {
    const output = join(temporary, `${branch.replace('/', '-')}.output`);
    const summary = `${output}.summary`;
    const isolated = { ...process.env, ...env, GITHUB_REF_NAME: branch, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
    const child = spawnSync(process.execPath, [resolve('website/publish.mjs'), 'prepare'], { cwd: temporary, env: isolated, encoding: 'utf8' });
    assert.equal(child.status, branch === 'main' ? 1 : 0);
    assert.equal(await readFile(output, 'utf8'), 'deploy=false\n');
    assert((await readFile(summary, 'utf8')).includes('未部署'));
    assert((await readFile(summary, 'utf8')).includes('CLOUDFLARE_API_TOKEN'));
  }
});

const online = { url: 'https://abc.runweft-test.pages.dev/', subdomain: project.subdomain, mode: 'preview', pagesEnvironment: 'preview', site };
async function serveFixture(url) {
  const name = new URL(url).pathname.slice(1);
  const mime = name.endsWith('.html') ? 'text/html' : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.css') ? 'text/css' : 'text/javascript';
  const response = new Response(await readFile(join(directory, name)), { headers: { 'content-type': mime + '; charset=utf-8' } });
  Object.defineProperty(response, 'url', { value: url.replace(/\/index.html$/, '/').replace(/\.html$/, '') });
  return response;
}

test('unique deployment verifies all bytes and MIME after same-host HTML redirects; transient GET retries', async () => {
  let calls = 0, pauses = 0;
  const result = await verifyDeployment(online, { fetchImpl: async url => ++calls === 1 ? json({}, 503) : serveFixture(url), pause: async () => { pauses++; } });
  assert.equal(result.success, true);
  assert.equal(result.files.length, 8);
  assert.equal(calls, 9);
  assert.equal(pauses, 1);
});

test('wrong deployment, Access redirect, wrong MIME/content and propagation failure cannot pass', async () => {
  for (const change of [{ url: 'https://evil.invalid/' }, { pagesEnvironment: 'production' }, { url: 'https://abc.runweft-test.pages.dev/downloads/' }]) {
    await assert.rejects(verifyDeployment({ ...online, ...change }, { fetchImpl: () => { throw new Error('unexpected request'); } }));
  }
  await assert.rejects(verifyDeployment(online, { fetchImpl: async () => { const response = json({}); Object.defineProperty(response, 'url', { value: 'https://cloudflareaccess.com/login' }); return response; } }), /Access/);
  await assert.rejects(verifyDeployment(online, { fetchImpl: async () => json({}) }), /MIME/);
  await assert.rejects(verifyDeployment(online, { fetchImpl: async () => new Response('wrong', { headers: { 'content-type': 'image/svg+xml' } }) }), /内容/);
  await assert.rejects(verifyDeployment(online, { fetchImpl: async () => json({}, 404), pause: async () => {}, attempts: 2 }), /HTTP 404/);
});
