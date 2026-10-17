import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadJobLog } from '../scripts/npm-release.mjs';
import { deploymentReference, deploymentTarget, validateSite } from './publish.mjs';

export async function recoverDeployment(env, { site,
  query = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 60_000 })),
  readLog = downloadJobLog,
} = {}) {
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', '仅手动入口可复验已上传部署。');
  assert.match(env.VERIFY_RUN_ID ?? '', /^[1-9]\d*$/, '原官网 run ID 无效。');
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const target = deploymentTarget(env);
  assert.notEqual(target.mode, 'check', '复验只支持 main 或 codex 分支。');
  const prefix = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.VERIFY_RUN_ID}`;
  const run = await query(prefix);
  assert.equal(run.id, Number(env.VERIFY_RUN_ID));
  assert.equal(run.path, '.github/workflows/website-pages.yml', '来源不是官网工作流。');
  assert(['push', 'workflow_dispatch'].includes(run.event), '不能使用 PR 等非部署事件的回执。');
  assert.equal(run.head_repository?.full_name, env.GITHUB_REPOSITORY, '不能使用其他仓库的部署回执。');
  assert.equal(run.status, 'completed', '原部署仍在运行，先等待已知结果。');
  assert.equal(run.head_branch, target.branch, '不能复验其他分支的部署。');
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const { jobs } = await query(`${prefix}/attempts/${run.run_attempt}/jobs?per_page=100`);
  const selected = jobs.filter(job => job.name === 'website' && job.status === 'completed');
  assert.equal(selected.length, 1, '原官网 job 缺失或不唯一。');
  assert(selected[0].steps?.some(step => step.name === 'Upload to Cloudflare Pages' && step.conclusion === 'success'),
    '必须指定实际上传的原 run，不能把复验 run 当作上传来源。');
  const log = await readLog(env.GITHUB_REPOSITORY, selected[0].id, { token: env.GH_TOKEN });
  const reports = new Map();
  for (const line of log.split('\n')) {
    const match = line.match(/RUNWEFT_CI_EVIDENCE=(\{.*\})\s*$/);
    if (!match) continue;
    const { path, report } = JSON.parse(match[1]);
    if (!['check', 'deployment', 'prepare'].some(name => path === `.dev-smoke/website-pages/${name}.json`)) continue;
    assert(!reports.has(path), '原官网证据重复。');
    reports.set(path, report);
  }
  const check = reports.get('.dev-smoke/website-pages/check.json');
  const receipt = reports.get('.dev-smoke/website-pages/deployment.json');
  const prepared = reports.get('.dev-smoke/website-pages/prepare.json');
  assert(check?.success === true && (receipt?.uploaded === true || receipt?.success === true) && prepared, '缺少原静态检查或已上传回执。');
  assert(!check.verificationOnly && !receipt.verificationOnly, '复验记录不能替代原上传回执。');
  assert.equal(check.sourceRevision, run.head_sha);
  assert.equal(receipt.sourceRevision, run.head_sha);
  assert.equal(prepared.branch, target.branch); assert.equal(receipt.branch, target.branch);
  assert.equal(prepared.mode, target.mode); assert.equal(receipt.mode, target.mode);
  assert.equal(prepared.project, env.CLOUDFLARE_PAGES_PROJECT || 'runweft', '原 Pages 项目与当前配置不一致。');
  assert.match(prepared.subdomain, /^[a-z0-9-]+\.pages\.dev$/);
  site ??= await validateSite(resolve('dist/website'));
  assert.deepEqual(check.release, site.release, '原官网版本或安装元数据不一致。');
  assert.deepEqual(check.files, site.files, '静态文件与原部署不一致，不能只复验。');
  const reference = { url: receipt.url, subdomain: prepared.subdomain, mode: target.mode,
    pagesEnvironment: receipt.pagesEnvironment ?? receipt.mode, site };
  reference.url = deploymentReference(reference).deployment.href;
  return { reference, prepared, check: { success: true, sourceRevision: env.GITHUB_SHA, ...site,
    verificationOnly: true, sourceRunId: run.id },
    recovery: { sourceRunId: run.id, sourceAttempt: run.run_attempt, sourceRevision: run.head_sha,
      sourceJobId: selected[0].id, url: reference.url, uploaded: false, verificationOnly: true } };
}

async function main() {
  const result = await recoverDeployment(process.env);
  assert(process.env.RUNWEFT_WORK_DIR, 'Set RUNWEFT_WORK_DIR');
  const directory = resolve(process.env.RUNWEFT_WORK_DIR, 'website');
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries({ check: result.check, recovery: result.recovery, prepare: result.prepared })) {
    const file = resolve(directory, name + '.json');
    await writeFile(file, JSON.stringify(value, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}-report=${file}\n`);
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `verify=true\nurl=${result.reference.url}\nenvironment=${result.reference.pagesEnvironment}\n`);
  console.log(JSON.stringify(result.recovery));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
