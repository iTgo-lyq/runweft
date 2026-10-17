import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { assertReleaseResults, collectReleaseEvidence, dispatchWebsite, selectWebsiteRelease, websiteRunName } from '../release-finish.mjs';
import { packageNames } from '../npm-publish.mjs';

const env = { GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'fixture-token', GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '2' };
const version = '1.2.0', hapi = { revision: 'b'.repeat(40), version: '0.30.7', protocolVersion: 1 };
const release = { product: 'hub-console-v1', version, source: { revision: 'a'.repeat(40), dirty: false }, hapi,
    latestBefore: Object.fromEntries(packageNames.map(name => [name, '1.1.0'])), packages: packageNames.map(name => ({
        name, version, path: name, tarball: `tarballs/${name}-${version}.tgz`, sha512: 'a'.repeat(86) + '==',
        binaries: { 'bin/runweft': 'c'.repeat(64), 'bin/hapi': 'd'.repeat(64) }, manifest: {
            name, version, repository: { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' },
            ...(name === 'runweft' ? { optionalDependencies: Object.fromEntries(packageNames.filter(item => item !== name).map(item => [item, version])) }
                : { runweft: { hapi } }),
        },
    })) };
const run = { id: 20, path: '.github/workflows/website-pages.yml', event: 'workflow_dispatch', head_branch: 'main',
    display_title: websiteRunName(version, '10', '2'), status: 'completed', conclusion: 'success', run_attempt: 1 };

test('website dispatch binds the returned run and waits for actual completion', async () => {
    const calls = [], records = []; let reads = 0;
    const result = await dispatchWebsite(release, env, { wait: async () => {}, record: value => records.push(value), request: async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'POST') {
            assert.deepEqual(JSON.parse(options.body), { ref: 'main', inputs: { 'release-version': version, 'release-run-id': '10', 'release-attempt': '2' } });
            return Response.json({ workflow_run_id: 20 });
        }
        reads++; return Response.json(reads === 1 ? { ...run, display_title: 'website Pages', status: 'queued', conclusion: null }
            : reads === 2 ? { ...run, status: 'in_progress', conclusion: null } : run);
    } });
    assert.equal(result.status, 'success'); assert.equal(reads, 3);
    assert.equal(records[0].status, 'pending'); assert.equal(records.at(-1).status, 'success');
    assert(calls.slice(1).every(call => call.url.endsWith('/actions/runs/20')));
    assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
});

test('unknown dispatch, mismatched run, failure and timeout never resend or report success', async () => {
    for (const scenario of ['unknown', 'wrong-branch', 'wrong-title', 'completed-placeholder', 'failure', 'cancelled', 'timeout', 'placeholder-timeout']) {
        let posts = 0, clock = 0; const records = [];
        await assert.rejects(dispatchWebsite(release, env, { now: () => clock, timeoutMs: 10,
            wait: async ms => { clock += ms; }, record: item => records.push(item), request: async (_, options) => {
                if (options.method === 'POST') {
                    posts++;
                    if (scenario === 'unknown') throw new Error('private request detail');
                    return Response.json({ workflow_run_id: 20 });
                }
                return Response.json({ ...run, ...(scenario === 'wrong-branch' ? { head_branch: 'stale' } : {}),
                    ...(scenario === 'wrong-title' ? { display_title: 'another release' } : {}),
                    ...(scenario === 'completed-placeholder' ? { display_title: 'website Pages' } : {}),
                    ...(scenario === 'timeout' ? { status: 'in_progress', conclusion: null } : {}),
                    ...(scenario === 'placeholder-timeout' ? { display_title: 'website Pages', status: 'queued', conclusion: null } : {}),
                    ...(['failure', 'cancelled'].includes(scenario) ? { conclusion: scenario } : {}) });
            } }));
        assert.equal(posts, 1); assert(!records.some(item => item.status === 'success'));
    }
    assert.throws(() => websiteRunName('1.2.0-beta.1', '10', '2'));
});

test('website starts independently while final summary joins all release gates and read-only recovery cannot upload', () => {
    const publish = parse(readFileSync('.github/workflows/npm-publish.yml', 'utf8'));
    const site = parse(readFileSync('.github/workflows/website-pages.yml', 'utf8'));
    assert.equal(publish.jobs.website.needs, undefined);
    assert.match(publish.jobs.website.if, /inputs.verify-run-id == ''/);
    const start = publish.jobs.website.steps.find(step => step.id === 'website');
    assert.equal(start.env.RELEASE_TAG, '${{ github.event_name == \'push\' && github.ref_name || inputs.release-tag }}');
    assert.equal(start.env.RELEASE_DESCRIPTOR, undefined);
    assert.equal(publish.jobs.website.steps[0].with['fetch-depth'], 0);
    assert.equal(publish.jobs.website.permissions['actions'], 'write');
    assert.equal(publish.jobs.website.permissions['id-token'], undefined);
    assert.equal(publish.jobs.summary.if, 'always()');
    assert.equal(publish.jobs.summary.permissions.actions, 'read');
    assert(publish.jobs.summary.needs.includes('website'));
    assert.equal(publish.jobs.summary.steps.find(step => step.run === 'node scripts/release-finish.mjs summary').env.RELEASE_RESULTS, '${{ toJSON(needs) }}');
    assert.match(site['run-name'], /release-version.*release-run-id.*release-attempt/);
    assert.match(site.jobs.website.steps.find(step => step.id === 'prepare').if, /publication.outputs.ready/);
    for (const id of ['prepare', 'pages']) assert.match(site.jobs.website.steps.find(step => step.id === id).if, /inputs.verify-run-id == ''/);
    assert(site.jobs.website.steps.some(step => step.id === 'recovered' && step.run === 'node website/recover.mjs'));
    assert(site.jobs.website.steps.some(step => step.run === 'node website/publish.mjs current'));
    assert(site.jobs.website.steps.some(step => step.run?.includes('node website/verify-live.mjs')));
});

test('parallel website selects only an immutable stable tag; preflight, beta and read-only checks do not dispatch', () => {
    const request = { RELEASE_TAG: 'v1.2.0', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.0' };
    const git = args => args[0] === 'show' ? JSON.stringify({ version }) : 'a'.repeat(40);
    assert.equal(selectWebsiteRelease(request, { git }).version, version);
    for (const update of [{ RELEASE_TAG: '' }, { RELEASE_TAG: 'v1.2.0-beta.1' }, { VERIFY_RUN_ID: '12' }]) {
        assert.equal(selectWebsiteRelease({ ...request, ...update }, { git: () => assert.fail('must not resolve/deploy') }), null);
    }
    for (const update of [{ RELEASE_TAG: 'v1.02.0' }, { GITHUB_REF_TYPE: 'branch' }, { GITHUB_EVENT_NAME: 'pull_request' },
        { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'codex/test' }]) {
        assert.throws(() => selectWebsiteRelease({ ...request, ...update }, { git }));
    }
    assert.throws(() => selectWebsiteRelease(request, { git: args => args[0] === 'show' ? '{"version":"9.0.0"}' : git(args) }), /differs/);
});

test('parallel dispatch needs no published descriptor but still binds version and actual child run', async () => {
    let posts = 0;
    const result = await dispatchWebsite({ version }, env, { parallel: true, request: async (_, options) => {
        if (options.method === 'POST') {
            posts++;
            assert.equal(JSON.parse(options.body).inputs['release-parallel'], 'true');
            return Response.json({ workflow_run_id: 20 });
        }
        return Response.json(run);
    } });
    assert.equal(result.status, 'success'); assert.equal(posts, 1);
});

test('website success cannot hide npm failure and missing or unsuccessful website cannot complete a stable release', () => {
    const needs = { beta: { result: 'success', outputs: { publish: 'true', 'site-install': 'true', 'validation-mode': 'public' } },
        install: { result: 'success' }, integration: { result: 'success' }, promote: { result: 'success' },
        website: { result: 'success', outputs: { 'run-id': '20' } } };
    assertReleaseResults(needs);
    for (const name of ['beta', 'install', 'integration', 'promote', 'website']) for (const result of ['failure', 'cancelled', 'skipped']) {
        const changed = structuredClone(needs); changed[name].result = result;
        assert.throws(() => assertReleaseResults(changed));
    }
    const missing = structuredClone(needs); missing.website.outputs = {};
    assert.throws(() => assertReleaseResults(missing), /Missing actual website run/);
    assertReleaseResults({ ...needs, beta: { result: 'success', outputs: { ...needs.beta.outputs, publish: 'false', 'verify-only': 'true' } },
        promote: { result: 'skipped' }, website: { result: 'skipped' } });
    assertReleaseResults({ beta: { result: 'success', outputs: { publish: 'false' } } });
});

test('summary skips intentionally skipped jobs and marks unavailable started-job logs as incomplete', async () => {
    let reads = 0, waits = 0;
    const options = {
        request: async url => Response.json(url.endsWith('/actions/runs/10')
            ? { id: 10, run_attempt: 1, path: '.github/workflows/npm-publish.yml' }
            : { total_count: 2, jobs: [{ id: 1, name: 'integration', status: 'completed', conclusion: 'skipped' },
                { id: 2, name: 'beta', status: 'completed', conclusion: 'success', started_at: '2026-10-12T10:00:00Z' }] }),
        readLog: async () => { reads++; assert.equal(404, 200); }, wait: async () => { waits++; },
    };
    const result = await collectReleaseEvidence(env, options);
    assert.equal(reads, 3); assert.equal(waits, 2);
    assert.equal(result.missingLogs.length, 1); assert.equal(result.missingLogs[0].jobId, 2);
    const recovered = await collectReleaseEvidence(env, { ...options, readLog: async () => {
        reads++; if (reads === 4) assert.equal(404, 200); return 'RUNWEFT_PUBLIC_READ={"success":true}';
    } });
    assert.deepEqual(recovered.missingLogs, []); assert.equal(recovered.records.length, 1);
});

test('summary includes failed website runs from every release attempt before a successful retry', async () => {
    const logIds = [];
    const result = await collectReleaseEvidence({ ...env, WEBSITE_RUN_ID: '22' }, {
        request: async url => {
            const [, id, attempt] = url.match(/\/runs\/(\d+)(?:\/attempts\/(\d+))?/);
            if (!attempt) return Response.json({ id: Number(id), run_attempt: id === '10' ? 2 : 1,
                path: id === '10' ? '.github/workflows/npm-publish.yml' : run.path,
                status: 'completed', conclusion: id === '21' ? 'failure' : 'success' });
            return Response.json({ total_count: 1, jobs: [{ id: Number(id) * 10 + Number(attempt),
                name: 'website', status: 'completed', conclusion: id === '21' ? 'failure' : 'success', labels: ['linux'],
                created_at: `2026-10-12T10:0${attempt}:00Z`, started_at: `2026-10-12T10:0${attempt}:01Z`,
                completed_at: `2026-10-12T10:0${attempt}:04Z` }] });
        }, readLog: async (_, id) => {
            logIds.push(id);
            if (id === 101 || id === 102) return 'RUNWEFT_RELEASE_WEBSITE=' + JSON.stringify({ runId: id === 101 ? 21 : 22 });
            return 'RUNWEFT_CI_EVIDENCE={"success":' + (id === 221) + '}';
        },
    });
    assert.deepEqual(result.runs.map(item => item.id).sort(), [10, 21, 22]);
    assert.equal(result.runs.find(item => item.id === 21).conclusion, 'failure');
    assert.equal(result.runnerMs.linux, 12_000);
    assert.deepEqual(logIds.sort(), [101, 102, 211, 221]);
    assert.equal(result.records.length, 4);
});
