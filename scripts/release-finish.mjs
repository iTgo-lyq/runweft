import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDescriptor, downloadJobLog } from './npm-release.mjs';
import { releaseChannel } from './npm-publish.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
function api(env, request = fetch) {
    assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert(env.GH_TOKEN, 'GH_TOKEN is required for release follow-up');
    return async (path, body, timeoutMs = 30_000) => {
        const response = await request('https://api.github.com/repos/' + env.GITHUB_REPOSITORY + '/' + path, {
            method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + env.GH_TOKEN,
                'content-type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, 200, 'GitHub release follow-up HTTP ' + response.status);
        return response.json();
    };
}

export function websiteRunName(version, runId, attempt) {
    assert.equal(releaseChannel(version), 'latest');
    assert.match(String(runId), /^[1-9]\d*$/); assert.match(String(attempt), /^[1-9]\d*$/);
    return `release ${version} from ${runId}/${attempt}`;
}

export async function dispatchWebsite(release, env, { request = fetch, wait = pause, now = Date.now,
    timeoutMs = 20 * 60_000, record = () => {} } = {}) {
    assertDescriptor(release);
    const name = websiteRunName(release.version, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT);
    const call = api(env, request), deadline = now() + timeoutMs;
    let accepted;
    try {
        accepted = await call('actions/workflows/website-pages.yml/dispatches', { ref: 'main', inputs: {
            'release-version': release.version, 'release-run-id': env.GITHUB_RUN_ID, 'release-attempt': env.GITHUB_RUN_ATTEMPT,
        } }, Math.min(30_000, timeoutMs));
    } catch {
        throw new Error('npm 已发布，官网触发结果未确认；检查官网 Actions 后仅恢复官网，不要重发 npm 或盲目再次 dispatch。');
    }
    assert(Number.isSafeInteger(accepted.workflow_run_id) && accepted.workflow_run_id > 0, '官网触发缺少实际 run ID；检查 Actions，不要盲目重发。');
    const id = accepted.workflow_run_id, url = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${id}`;
    record({ runId: id, url, status: 'pending', version: release.version });
    while (true) {
        assert(now() < deadline, 'npm 已发布，官网状态待确认：等待超时；仅检查/恢复官网 ' + url);
        const run = await call('actions/runs/' + id, undefined, Math.min(30_000, deadline - now()));
        assert.equal(run.path, '.github/workflows/website-pages.yml');
        assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.head_branch, 'main');
        assert.equal(run.display_title, name, '官网 run 与本次发布关联不符');
        if (run.status === 'completed') {
            const result = { runId: id, attempt: run.run_attempt, url, version: release.version, status: run.conclusion };
            record(result);
            assert.equal(run.conclusion, 'success', 'npm 已发布，官网未成功；仅恢复官网 ' + url);
            return result;
        }
        await wait(Math.min(5000, Math.max(0, deadline - now())));
    }
}

export function jobTiming(job, attempt) {
    const delta = (first, last) => {
        const a = Date.parse(first), b = Date.parse(last);
        return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
    };
    return { id: job.id, name: job.name, attempt: job.run_attempt ?? attempt, status: job.status,
        conclusion: job.conclusion, labels: job.labels ?? [], url: job.html_url,
        createdAt: job.created_at ?? null, startedAt: job.started_at ?? null, completedAt: job.completed_at ?? null,
        queuedMs: delta(job.created_at, job.started_at), runningMs: delta(job.started_at, job.completed_at) };
}

export async function collectReleaseEvidence(env, { request = fetch, readLog = downloadJobLog, wait = pause } = {}) {
    const call = api(env, request), runs = [], records = [], missingLogs = [];
    const ids = [...new Set([env.GITHUB_RUN_ID, env.WEBSITE_RUN_ID].filter(Boolean).map(String))];
    for (const id of ids) {
        assert.match(String(id), /^[1-9]\d*$/);
        const run = await call('actions/runs/' + id), jobs = new Map(), executions = new Map();
        assert.equal(run.path, id === String(env.GITHUB_RUN_ID)
            ? '.github/workflows/npm-publish.yml' : '.github/workflows/website-pages.yml');
        for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
            for (let page = 1; ; page++) {
                const result = await call(`actions/runs/${id}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
                for (const job of result.jobs) {
                    if (jobs.has(job.id)) continue;
                    const timing = jobTiming(job, attempt);
                    // GitHub gives retained successful jobs new IDs on failed-only reruns,
                    // while preserving their original execution timestamps.
                    const key = JSON.stringify([job.name, job.started_at, job.completed_at, job.conclusion, job.labels]);
                    const previous = executions.get(key);
                    if (previous && previous.attempt < attempt && Date.parse(job.created_at) > Date.parse(job.completed_at)) {
                        timing.reusedFromJobId = previous.id;
                    } else if (job.started_at && job.completed_at) executions.set(key, timing);
                    jobs.set(job.id, timing);
                    if (timing.reusedFromJobId) continue;
                    if (job.status !== 'completed' || job.conclusion === 'skipped' || !job.started_at || job.name === 'summary') continue;
                    let log;
                    for (let retry = 0; retry < 3; retry++) {
                        try { log = await readLog(env.GITHUB_REPOSITORY, job.id, { token: env.GH_TOKEN }); break; }
                        catch (error) {
                            if (error.actual === 404 && retry < 2) { await wait(5000 * (retry + 1)); continue; }
                            missingLogs.push({ runId: run.id, jobId: job.id, attempt, code: error.code ?? error.name,
                                status: Number.isInteger(error.actual) ? error.actual : null });
                            break;
                        }
                    }
                    if (log === undefined) continue;
                    for (const line of log.split('\n')) {
                        const match = line.match(/RUNWEFT_(RELEASE_DESCRIPTOR|RELEASE_WEBSITE|PUBLIC_READ|CI_EVIDENCE|INTEGRATION_CANDIDATE|PROMOTION)=(\{.*\})\s*$/);
                        if (match) {
                            const value = JSON.parse(match[2]);
                            records.push({ runId: run.id, jobId: job.id, attempt, kind: match[1], value });
                            if (id === String(env.GITHUB_RUN_ID) && match[1] === 'RELEASE_WEBSITE' && value.runId != null) {
                                assert(Number.isSafeInteger(value.runId) && value.runId > 0, 'Invalid associated website run ID');
                                if (!ids.includes(String(value.runId))) ids.push(String(value.runId));
                            }
                        }
                    }
                }
                if (page * 100 >= result.total_count) break;
            }
        }
        runs.push({ id: run.id, attempt: run.run_attempt, path: run.path, status: run.status,
            conclusion: run.conclusion, url: run.html_url, jobs: [...jobs.values()] });
    }
    const jobs = runs.flatMap(run => run.jobs), runnerMs = {};
    for (const job of jobs) if (job.runningMs != null && !job.reusedFromJobId) {
        const labels = job.labels.join(',') || 'unknown'; runnerMs[labels] = (runnerMs[labels] ?? 0) + job.runningMs;
    }
    return { runs, records, missingLogs, runnerMs, unknownJobTimes: jobs.filter(job => !job.reusedFromJobId && (job.runningMs == null || job.queuedMs == null)).map(job => job.id),
        note: '实际 job 排队/运行时长，非计费额度；未完成或缺失字段为未知，summary 自身未完成时长不计入。' };
}

function save(name, result) {
    mkdirSync('.dev-smoke/npm-release', { recursive: true });
    writeFileSync('.dev-smoke/npm-release/' + name + '.json', JSON.stringify(result, null, 2) + '\n');
    const summary = name === 'summary' ? { ...result, records: result.records.length } : result;
    console.log('RUNWEFT_RELEASE_' + name.toUpperCase() + '=' + JSON.stringify(summary));
    if (name === 'summary') for (const record of result.records) console.log('RUNWEFT_RELEASE_EVIDENCE=' + JSON.stringify(record));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n');
}

async function main() {
    if (process.argv[2] === 'website') {
        let recorded;
        try {
            await dispatchWebsite(JSON.parse(process.env.RELEASE_DESCRIPTOR), process.env, { record: value => {
                recorded = value; save('website', value);
                if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'run-id=' + value.runId + '\n');
            } });
        } catch (error) { save('website', { ...recorded, success: false, message: error.message }); throw error; }
    } else if (process.argv[2] === 'summary') {
        const result = await collectReleaseEvidence(process.env);
        save('summary', result);
        assert.equal(result.missingLogs.length, 0, '发布摘要含无法取得的日志；已保留可用证据，仅恢复 summary，不重发 npm。');
    } else throw new Error('Usage: node scripts/release-finish.mjs website|summary');
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
