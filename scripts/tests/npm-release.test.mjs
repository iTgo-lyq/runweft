import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { assertDescriptor, downloadJobLog, downloadRelease, prepareVerification, promoteRelease, previousRunLog, readReleaseLog, recoveryMode, releaseChecks, restoreMainTarball, unpackRelease, verifyPublicRelease } from '../npm-release.mjs';
import { npmPublishArgs, packageNames, publishCandidate, registry } from '../npm-publish.mjs';
import { publicReadBudget, publicResponse } from '../npm-read.mjs';

const bytes = Buffer.from('public tarball fixture');
const hash = createHash('sha512').update(bytes).digest('base64');
const hapi = { revision: 'b'.repeat(40), version: '0.30.7', protocolVersion: 1 };
function descriptor(version = '1.2.0') {
    return {
        product: 'hub-console-v1', version, source: { revision: 'a'.repeat(40), dirty: false }, hapi,
        latestBefore: Object.fromEntries(packageNames.map(name => [name, '1.1.1'])),
        packages: packageNames.map(name => ({
            name, version, path: name, tarball: 'tarballs/' + name + '-' + version + '.tgz', sha512: hash,
            ...(name === 'runweft' ? {} : { binaries: { 'bin/runweft': 'c'.repeat(64), 'bin/hapi': 'd'.repeat(64) } }),
            manifest: { name, version, repository: { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' },
                ...(name === 'runweft' ? { optionalDependencies: Object.fromEntries(packageNames.slice(0, -1).map(name => [name, version])) }
                    : { runweft: { hapi } }) },
        })),
    };
}
const publicManifest = entry => ({ ...entry.manifest, dist: { integrity: 'sha512-' + entry.sha512,
    tarball: registry + entry.name + '/-/' + entry.name + '-' + entry.version + '.tgz' } });
function promotionOptions(release, overrides = {}) {
    const current = Object.fromEntries(packageNames.map(name => [name, { latest: '1.1.1', beta: release.version }]));
    const updates = [];
    return {
        installationResult: 'success', betaResult: 'success',
        validationMode: release.version.includes('-beta.') ? 'inline' : 'public', integrationResult: release.version.includes('-beta.') ? 'skipped' : 'success', read: async entry => publicManifest(entry),
        tags: async entry => ({ ...current[entry.name] }),
        setTag: async (entry, tag) => { updates.push(entry.name); current[entry.name][tag] = entry.version; },
        current, updates, ...overrides,
    };
}

test('stable candidates upload beta and preserve latest before platform verification', async () => {
    const release = descriptor(), publicNames = new Set(), channels = {};
    const state = await publishCandidate(release, release.packages, {
        channel: 'beta', tags: async entry => ({ latest: '1.1.1', ...channels[entry.name] }),
        metadata: async entry => publicNames.has(entry.name) ? publicManifest(entry) : null,
        upload: async entry => {
            assert(npmPublishArgs(entry, { channel: 'beta' }).includes('--tag=beta'));
            publicNames.add(entry.name); channels[entry.name] = { beta: entry.version }; return 0;
        }, save() {},
    });
    assert.equal(state.channel, 'beta'); assert.equal(state.success, true);
    assert.equal(Object.values(state.distTags).every(tags => tags.latest === '1.1.1'), true);
});

test('read-only public validation requires original provenance and frozen inputs, and can never authorize a mutation', async () => {
    const release = descriptor(), env = { GITHUB_EVENT_NAME: 'workflow_dispatch', VERIFY_RUN_ID: '123' }, calls = [];
    const options = {
        load: async input => { assert.equal(input.SOURCE_RUN_ID, '123'); return { release, prepublicationVerified: true }; },
        checkInputs: candidate => { assert.equal(candidate, release); calls.push('frozen'); },
        verify: async candidate => { assert.equal(candidate, release); calls.push('public'); },
    };
    const result = await prepareVerification(env, options);
    assert.deepEqual(calls, ['frozen', 'public']);
    assert.equal(result.publish, false); assert.equal(result.build, false); assert.equal(result['verify-only'], true);
    assert.equal(result['public-integration'], true); assert.equal(result['site-install'], true);
    assert.deepEqual(JSON.parse(result.release), release);
    for (const override of [{ GITHUB_EVENT_NAME: 'push' }, { RELEASE_TAG: 'v1.2.0' }, { SOURCE_RUN_ID: '456' }, { VERIFY_RUN_ID: '0' }]) {
        await assert.rejects(prepareVerification({ ...env, ...override }, options));
    }
    await assert.rejects(prepareVerification(env, { ...options, load: async () => ({ release }) }), /original candidate/);
    await assert.rejects(prepareVerification(env, { ...options, checkInputs: () => { throw new Error('inputs changed'); } }), /inputs changed/);
    await assert.rejects(prepareVerification(env, { ...options, verify: async () => { throw new Error('hash changed'); } }), /hash changed/);
    for (const command of ['beta', 'promote']) {
        const run = spawnSync(process.execPath, ['scripts/npm-release.mjs', command], { env: { ...process.env, VERIFY_ONLY: 'true' }, encoding: 'utf8' });
        assert.equal(run.status, 1); assert.match(run.stderr, /Read-only verification cannot/);
    }
});

test('recovery refuses partial, unknown, missing provenance log and wrong source candidates', () => {
    const release = descriptor(), source = release.source.revision, version = release.version;
    assert.equal(recoveryMode(Array(5).fill(null), {}, source, version), 'build');
    assert.throws(() => recoveryMode(Array(5).fill(null), { uploadStarted: true }, source, version), /outcome unknown/);
    assert.throws(() => recoveryMode([{}, null, null, null, null], {}, source, version), /Partial beta/);
    assert.throws(() => recoveryMode(Array(5).fill({}), {}, source, version), /source-run-id/);
    assert.throws(() => recoveryMode(Array(5).fill({}), { release }, 'f'.repeat(40), version), /different tag/);
    assert.equal(recoveryMode(Array(5).fill({}), { release, prepublicationVerified: true }, source, version), 'existing');
    const log = '2026-10-11T00:00:00Z RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft-linux-x64\n';
    assert.deepEqual(readReleaseLog(log), { release, uploadStarted: true, uploads: ['runweft-linux-x64'], receipt: undefined });
    const bad = structuredClone(release); bad.packages[0].path = '../escape';
    assert.throws(() => assertDescriptor(bad));
});

test('source log recovery captures ANSI as data and keeps GitHub authorization off the signed download', async () => {
    const release = descriptor(), calls = [], location = 'https://logs.example.test/source?signed=fixture';
    const log = '\u001b[36m2026-10-11T00:00:00Z normal runner output\u001b[0m\n' +
        '2026-10-11T00:00:00Z RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft\n';
    const recovered = await downloadJobLog('owner/repo', 123, { token: 'fixture-token', request: async (url, options) => {
        calls.push({ url: String(url), options });
        return calls.length === 1 ? new Response(null, { status: 302, headers: { location } }) : new Response(log);
    } });
    assert.deepEqual(readReleaseLog(recovered), { release, uploadStarted: true, uploads: ['runweft'], receipt: undefined });
    assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/actions/jobs/123/logs');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-token');
    assert.equal(calls[1].url, location);
    assert.equal(calls[1].options.headers, undefined);
    await assert.rejects(downloadJobLog('owner/repo', 123, { token: 'fixture-token',
        request: async () => new Response(null, { status: 403 }) }), /redirect HTTP 403/);
});

test('four native job failures prevent promotion before any public check or mutation', async () => {
    for (const installationResult of ['failure', 'cancelled', 'skipped', '']) {
        await assert.rejects(promoteRelease(descriptor(), { installationResult, read() { throw new Error('Unexpected request'); } }), /four native/);
    }
});

test('all five release modes retain their required integration and recovery evidence', async () => {
    assert.deepEqual(releaseChecks('1.2.0', false, 'build'), { publicIntegration: false,
        inlineIntegration: true, siteInstall: false });
    assert.equal(releaseChecks('1.2.0-beta.1', true, 'build').publicIntegration, false);
    assert.equal(releaseChecks('1.2.0', true, 'build').inlineIntegration, false);
    for (const version of ['1.2.0', '1.2.0-beta.1']) {
        const release = descriptor(version);
        assert.equal(releaseChecks(version, true, 'existing').publicIntegration, true);
        assert.throws(() => recoveryMode(Array(5).fill({}), { release }, release.source.revision, version), /prepublication/);
        assert.equal(recoveryMode(Array(5).fill({}), { release, prepublicationVerified: true }, release.source.revision, version), 'existing');
        for (const integrationResult of ['failure', 'cancelled', 'skipped', undefined]) {
            const options = promotionOptions(release, { validationMode: 'public', integrationResult });
            await assert.rejects(promoteRelease(release, options), /integration/);
            assert.deepEqual(options.updates, []);
        }
        for (const betaResult of ['failure', 'cancelled', 'skipped', undefined]) {
            const options = promotionOptions(release, { betaResult });
            await assert.rejects(promoteRelease(release, options), /prepublication/);
            assert.deepEqual(options.updates, []);
        }
        const result = await promoteRelease(release, promotionOptions(release, { validationMode: 'public', integrationResult: 'success' }));
        assert.equal(result.promoted, !version.includes('-beta.'));
    }
    await assert.rejects(promoteRelease(descriptor(), promotionOptions(descriptor(), {
        validationMode: 'inline', integrationResult: 'skipped' })), /Stable releases require/);
});

test('prerelease recovery reads original successful gates for rerun-all and main/source-run-id', async () => {
    const release = descriptor('1.2.0-beta.1');
    for (const sourceRun of ['', '100']) {
        const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '101', GITHUB_RUN_ATTEMPT: '2', SOURCE_RUN_ID: sourceRun };
        const original = sourceRun || env.GITHUB_RUN_ID, paths = [];
        const options = {
            query: async path => {
                paths.push(path); assert([original, env.GITHUB_RUN_ID].some(id => path.startsWith('repos/owner/repo/actions/runs/' + id)));
                return path.endsWith('/jobs?per_page=100') ? { jobs: [{ name: 'beta', id: 1, steps: [{
                    name: 'Check every model-free integration group on the frozen candidate', conclusion: 'success',
                }] }] } : { path: '.github/workflows/npm-publish.yml', run_attempt: 1 };
            }, readLog: async () => 'RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft',
        };
        const prior = await previousRunLog(env, options);
        assert.equal(recoveryMode(Array(5).fill({}), prior, release.source.revision, release.version), 'existing');
        assert.equal(releaseChecks(release.version, true, 'existing').publicIntegration, true);
        assert.equal(paths.length, sourceRun ? 4 : 2);
        const missing = await previousRunLog(env, { ...options, query: async path => {
            const value = await options.query(path); if (value.jobs) value.jobs[0].steps[0].conclusion = 'skipped'; return value;
        } });
        assert.throws(() => recoveryMode(Array(5).fill({}), missing, release.source.revision, release.version), /prepublication/);
    }
});

test('public integration extracts the bound archive and rejects either changed program', () => {
    const directory = mkdtempSync(join(tmpdir(), 'unpack-candidate-'));
    const release = descriptor(), entry = release.packages.find(item => item.name === 'runweft-linux-x64');
    const source = join(directory, 'fixture'); mkdirSync(join(source, 'package/bin'), { recursive: true });
    mkdirSync(join(directory, 'tarballs'));
    writeFileSync(join(source, 'package/package.json'), JSON.stringify(entry.manifest));
    for (const name of ['runweft', 'hapi']) {
        writeFileSync(join(source, 'package/bin', name), name);
        entry.binaries['bin/' + name] = createHash('sha256').update(name).digest('hex');
    }
    try {
        assert.equal(spawnSync('tar', ['-czf', join(directory, entry.tarball), '-C', source, 'package']).status, 0);
        entry.sha512 = createHash('sha512').update(readFileSync(join(directory, entry.tarball))).digest('base64');
        const result = unpackRelease(release, directory, 'linux-x64');
        assert.equal(result.binaries.hapi.sha256, entry.binaries['bin/hapi']);
        for (const name of ['runweft', 'hapi']) {
            const bad = structuredClone(release);
            bad.packages.find(item => item.name === entry.name).binaries['bin/' + name] = 'e'.repeat(64);
            assert.throws(() => unpackRelease(bad, directory, 'linux-x64'), /hash differs/);
        }
        writeFileSync(join(directory, entry.tarball), 'corrupt');
        assert.throws(() => unpackRelease(release, directory, 'linux-x64'), /archive changed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('promotion checks every integrity before writes and advances main last', async () => {
    const release = descriptor(), options = promotionOptions(release);
    const result = await promoteRelease(release, options);
    assert.equal(result.success, true);
    assert.deepEqual(options.updates, packageNames);
    assert.equal(Object.values(result.distTags).every(tags => tags.latest === release.version), true);
    const bad = promotionOptions(release, { read: async entry => entry.name === 'runweft' ?
        { ...publicManifest(entry), dist: { integrity: 'wrong' } } : publicManifest(entry) });
    await assert.rejects(promoteRelease(release, bad), /published version differs/);
    assert.deepEqual(bad.updates, []);
});

test('default promotion reader requests exact versions with a bounded signal for stable and prerelease', async t => {
    for (const version of ['1.2.0', '1.2.0-beta.1']) {
        const release = descriptor(version), urls = [];
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            urls.push(String(url));
            assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
            const entry = release.packages.find(entry => String(url) === registry + entry.name + '/' + version);
            assert(entry, 'Incorrect exact-version URL: ' + url);
            return Response.json(publicManifest(entry));
        });
        const options = promotionOptions(release, { read: undefined });
        const result = await promoteRelease(release, options);
        assert.equal(result.success, true); assert.equal(urls.length, 5);
        assert.equal(options.updates.length, version.includes('-beta.') ? 0 : 5);
        t.mock.restoreAll();
    }
});

test('response cleanup errors cannot turn authorization failures into retried network failures', async () => {
    for (const status of [401, 403]) {
        let requests = 0, retries = 0;
        const read = publicReadBudget({ pause: async () => { retries++; } });
        await assert.rejects(read('metadata', signal => publicResponse(async () => {
            requests++;
            return new Response(new ReadableStream({ cancel() { throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); } }), { status });
        }, registry + 'runweft/1.2.0', signal)), new RegExp('HTTP ' + status));
        assert.equal(requests, 1); assert.equal(retries, 0);
    }
});

test('partial promotion resumes original packages and checks outside tag changes before mutations', async () => {
    const release = descriptor(), options = promotionOptions(release);
    options.current[packageNames[0]].latest = release.version;
    await promoteRelease(release, options);
    assert.deepEqual(options.updates, packageNames.slice(1));
    const moved = promotionOptions(release);
    moved.current.runweft.latest = '1.3.0';
    await assert.rejects(promoteRelease(release, moved), /latest changed/);
    assert.deepEqual(moved.updates, []);
    const betaMoved = promotionOptions(release);
    betaMoved.current.runweft.beta = '1.3.0-beta.1';
    await assert.rejects(promoteRelease(release, betaMoved), /beta changed/);
    assert.deepEqual(betaMoved.updates, []);
});

test('real prerelease versions remain on beta after native verification', async () => {
    const release = descriptor('1.2.0-beta.1'), options = promotionOptions(release);
    const result = await promoteRelease(release, options);
    assert.equal(result.promoted, false); assert.equal(result.channel, 'beta');
    assert.deepEqual(options.updates, []);
});

test('registry visibility retries only reads; corrupted download refuses installation input', async () => {
    const release = descriptor(); let missing = true, reads = 0, pauses = 0;
    await verifyPublicRelease(release, {
        read: async entry => { reads++; return missing ? null : publicManifest(entry); },
        pause: async () => { pauses++; missing = false; },
    });
    assert.equal(reads, 10); assert.equal(pauses, 5);
    const directory = mkdtempSync(join(tmpdir(), 'public-candidate-test-'));
    const downloads = [];
    try {
        await downloadRelease(release, directory, { platform: 'linux-x64', read: async entry => publicManifest(entry),
            request: async url => { downloads.push(String(url)); return new Response(bytes); } });
        assert.equal(downloads.length, 2);
        assert.deepEqual(JSON.parse(readFileSync(join(directory, 'index.json'))), release);
        await assert.rejects(downloadRelease(release, directory, {
            read: async entry => publicManifest(entry), request: async () => new Response('corrupt'),
        }), /downloaded tarball differs/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workflow topology requires all four platforms and has no artifact dependency', () => {
    const load = name => {
        const text = readFileSync(resolve('.github/workflows/' + name), 'utf8');
        assert.doesNotMatch(text, /actions\/(?:upload|download)-artifact|gh run download/);
        return parse(text);
    };
    const publish = load('npm-publish.yml'), install = load('cli-install.yml');
    load('checks.yml'); load('website-pages.yml');
    assert.deepEqual(publish.jobs.promote.needs, ['beta', 'install', 'integration']);
    assert.match(publish.jobs.promote.if, /needs\.install\.result == 'success'/);
    assert.equal(publish.concurrency.group, 'npm-publish'); assert.equal(publish.concurrency['cancel-in-progress'], false);
    assert.match(publish.jobs.install.if, /needs.beta.outputs.verify-only == 'true'/);
    assert.match(publish.jobs.promote.if, /needs.beta.outputs.verify-only != 'true'/);
    assert.equal(publish.jobs.promote.steps.find(step => step.run === 'node scripts/npm-release.mjs promote').env.VERIFY_ONLY, '${{ needs.beta.outputs.verify-only }}');
    assert.equal(publish.jobs.beta.steps.find(step => step.id === 'published').env.VERIFY_ONLY, '${{ steps.prepared.outputs.verify-only }}');
    const installationRows = install.jobs.install.strategy.matrix.include;
    assert.deepEqual([...new Set(installationRows.map(row => row.platform))].sort(),
        ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
    assert.equal(installationRows.length, 4);
    assert(install.jobs.install.steps.some(step => step.run?.includes('test/acceptance/install.mjs') && step.run.includes('--case all')));
    assert.equal(install.permissions['id-token'], undefined);
    assert.equal(install.jobs.install['continue-on-error'], undefined);
    assert.equal(publish.jobs.integration.strategy['fail-fast'], false);
    assert.equal(publish.jobs.integration.permissions?.['id-token'], undefined);
    assert(publish.jobs.integration.steps.some(step => step.with?.submodules === true));
    assert.match(publish.jobs.promote.if, /always\(\).*needs.beta.result/s);
    assert.match(publish.jobs.promote.if, /needs.integration.result == 'success'/);
    assert.match(publish.jobs.promote.if, /needs.integration.result == 'skipped'/);
    assert.match(install.jobs.install.steps.find(step => step.run?.includes('node website/verify.mjs')).if, /linux-x64.*site-install/);
});

test('HTTP candidate reads retry propagation, throttling and interrupted bodies within one budget', async () => {
    const release = descriptor(), hits = new Map(), records = [], waits = [];
    let clock = 0;
    const server = createServer((req, res) => {
        const path = req.url, count = (hits.get(path) ?? 0) + 1; hits.set(path, count);
        const entry = release.packages.find(entry => path.startsWith('/' + entry.name + '/'));
        if (!path.includes('/-/')) {
            if (entry.name === 'runweft' && count === 1) { res.writeHead(404); res.end(); }
            else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(publicManifest(entry))); }
        } else if (count === 1) { res.writeHead(429, { 'retry-after': '3' }); res.end(); }
        else if (count === 2) {
            res.writeHead(200, { 'content-length': bytes.length }); res.write(bytes.subarray(0, 2));
            setImmediate(() => res.destroy());
        } else res.end(bytes);
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const directory = mkdtempSync(join(tmpdir(), 'public-retry-'));
    try {
        await downloadRelease(release, directory, { platform: 'linux-x64', now: () => clock,
            pause: async ms => { waits.push(ms); clock += ms; }, record: item => records.push(item),
            request: (url, options) => fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, options) });
        assert(waits.includes(3000));
        assert.equal(records.filter(item => item.success).length, 7);
        for (const entry of release.packages.filter(entry => ['runweft', 'runweft-linux-x64'].includes(entry.name))) {
            assert.deepEqual(readFileSync(join(directory, entry.tarball)), bytes);
            assert.equal(existsSync(join(directory, entry.tarball + '.partial')), false);
        }
    } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); rmSync(directory, { recursive: true, force: true }); }
});

test('candidate errors and one shared deadline cannot leave a partial archive or an installation index', async () => {
    const release = descriptor();
    for (const scenario of ['auth', 'gone', 'hash', 'url', 'retry-after', 'shared-budget', 'body-timeout']) {
        const directory = mkdtempSync(join(tmpdir(), 'public-refusal-'));
        let clock = 0, reads = 0, downloads = 0;
        const options = { platform: 'linux-x64', timeoutMs: 5000, now: () => clock,
            pause: async ms => { clock += ms; },
            read: async entry => {
                reads++;
                if (scenario === 'shared-budget' && reads <= 5) return null;
                const value = publicManifest(entry);
                if (scenario === 'url') value.dist.tarball = 'https://example.invalid/' + entry.name;
                return value;
            }, request: async (_, { signal }) => {
                downloads++;
                if (scenario === 'auth') return new Response(null, { status: 403 });
                if (scenario === 'gone') return new Response(null, { status: 410 });
                if (scenario === 'retry-after') return new Response(null, { status: 429, headers: { 'retry-after': '6' } });
                if (scenario === 'shared-budget') return new Response(null, { status: 404 });
                if (scenario === 'body-timeout') return new Response(new ReadableStream({
                    start(controller) { controller.enqueue(bytes.subarray(0, 2)); signal.addEventListener('abort', () => controller.error(signal.reason)); },
                }));
                return new Response('corrupt');
            } };
        if (scenario === 'body-timeout') { options.timeoutMs = 25; delete options.now; }
        // Keep the event loop alive while the actual AbortSignal interrupts a never-ending body.
        const keepAlive = setInterval(() => {}, 1000);
        try {
            await assert.rejects(downloadRelease(release, directory, options), /HTTP 403|HTTP 410|tarball differs|public npm|budget exhausted/);
            if (['auth', 'gone', 'hash', 'retry-after', 'body-timeout'].includes(scenario)) assert.equal(downloads, 1);
            if (scenario === 'url') assert.equal(downloads, 0);
            assert.equal(existsSync(join(directory, 'index.json')), false);
            for (const entry of release.packages) {
                assert.equal(existsSync(join(directory, entry.tarball)), false);
                assert.equal(existsSync(join(directory, entry.tarball + '.partial')), false);
            }
        } finally { clearInterval(keepAlive); rmSync(directory, { recursive: true, force: true }); }
    }
});

test('explicit report collection rejects absent/conflicting evidence and keeps website recovery IDs independent of disk paths', async () => {
    const { collectEvidence } = await import('../report-evidence.mjs');
    const directory = mkdtempSync(join(tmpdir(), 'runweft-evidence-'));
    try {
        const file = join(directory, 'deployment.json'); writeFileSync(file, JSON.stringify({ success: false, uploaded: true }));
        assert.deepEqual(collectEvidence([file], true), [{ path: '.dev-smoke/website-pages/deployment.json', report: { success: false, uploaded: true } }]);
        assert.throws(() => collectEvidence([]));
        assert.throws(() => collectEvidence([file, join(directory, 'missing.json')]));
        assert.throws(() => collectEvidence([file, file], true), /duplicate/);
        const child = spawnSync(process.execPath, ['scripts/report-evidence.mjs', file, join(directory, 'missing.json')], { encoding: 'utf8' });
        assert.notEqual(child.status, 0); assert.equal(child.stdout, '', 'No partial success envelope on missing later report');
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

function partialCandidate() {
    const release = descriptor();
    const receipt = { version: release.version, sourceRevision: release.source.revision, channel: 'beta',
        latestBefore: release.latestBefore, packages: release.packages.filter(p => p.name !== 'runweft').map(p => ({
            name: p.name, integrity: 'sha512-' + p.sha512, status: 'accepted',
        })) };
    return { release, receipt, uploads: packageNames.slice(0, 4), prepublicationVerified: true };
}

test('only the missing main can resume after four exact published platform receipts', async () => {
    const prior = partialCandidate(), { release } = prior;
    const manifests = release.packages.map(p => p.name === 'runweft' ? null : publicManifest(p));
    assert.equal(recoveryMode(manifests, prior, release.source.revision, release.version), 'main-only');
    let main = false; const uploads = [];
    await publishCandidate(release, release.packages, { channel: 'beta', receipt: prior.receipt,
        metadata: async p => p.name !== 'runweft' || main ? publicManifest(p) : null,
        tags: async p => ({ latest: '1.1.1', ...(p.name !== 'runweft' || main ? { beta: release.version } : {}) }),
        upload: async p => { uploads.push(p.name); main = true; return 0; }, save() {},
    });
    assert.deepEqual(uploads, ['runweft']);
    for (const mutate of [
        p => { delete p.receipt; }, p => { p.receipt.sourceRevision = 'f'.repeat(40); },
        p => { p.receipt.packages.pop(); }, p => { p.receipt.packages[0].integrity = 'bad'; },
        p => { p.receipt.packages[0].status = 'uploading'; }, p => { p.uploads.push('runweft'); },
        p => { p.receipt.latestBefore = {}; }, p => { p.prepublicationVerified = false; },
    ]) {
        const invalid = structuredClone(prior); mutate(invalid);
        assert.throws(() => recoveryMode(manifests, invalid, release.source.revision, release.version));
    }
    const bad = structuredClone(manifests); bad[0].dist.integrity = 'bad';
    assert.throws(() => recoveryMode(bad, prior, release.source.revision, release.version), /published version differs/);
});

test('recovery follows original gates and retains newer main upload uncertainty across retries', async () => {
    const prior = partialCandidate(), { release, receipt } = prior;
    const original = 'RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_PUBLICATION_STATE=' + JSON.stringify(receipt) + '\nRUNWEFT_UPLOAD_STARTED=runweft-linux-x64';
    const uncertain = structuredClone(receipt);
    uncertain.packages.push({ name: 'runweft', integrity: 'sha512-' + release.packages.at(-1).sha512, status: 'uploading' });
    const resumed = 'RUNWEFT_RECOVERY_SOURCE=100\nRUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) +
        '\nRUNWEFT_PUBLICATION_STATE=' + JSON.stringify(uncertain) + '\nRUNWEFT_UPLOAD_STARTED=runweft';
    const options = { query: async path => path.endsWith('/jobs?per_page=100') ? { jobs: [{ name: 'beta',
        id: path.includes('/100/') ? 1 : 2, steps: path.includes('/100/') ? [{
            name: 'Check every model-free integration group on the frozen candidate', conclusion: 'success',
        }] : [],
    }] } : { path: '.github/workflows/npm-publish.yml', run_attempt: 1 },
    readLog: async (repo, id) => id === 1 ? original : resumed };
    for (const env of [
        { SOURCE_RUN_ID: '100', GITHUB_RUN_ID: '101', GITHUB_RUN_ATTEMPT: '2' },
        { SOURCE_RUN_ID: '101', GITHUB_RUN_ID: '102', GITHUB_RUN_ATTEMPT: '1' },
    ]) {
        const recovered = await previousRunLog({ ...env, GITHUB_REPOSITORY: 'owner/repo' }, options);
        assert.equal(recovered.prepublicationVerified, true);
        assert.deepEqual(recovered.receipt, uncertain);
        assert.throws(() => recoveryMode(release.packages.map(p => p.name === 'runweft' ? null : publicManifest(p)),
            recovered, release.source.revision, release.version), /outcome unknown/);
    }
});

test('main recovery packs only frozen source files and requires the original tarball digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'restore-main-'));
    const repo = join(root, 'repo'), expected = join(root, 'expected'), release = descriptor();
    const entry = release.packages.at(-1);
    const run = (program, args, cwd) => {
        const result = spawnSync(program, args, { cwd, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    const put = (directory, path, content) => { mkdirSync(join(directory, path, '..'), { recursive: true }); writeFileSync(join(directory, path), content); };
    try {
        put(repo, 'src/npm-launcher.cjs', '#!/usr/bin/env node\n');
        put(repo, 'docs/usage.md', 'Usage fixture');
        put(repo, '.agents/skills/runweft-kit/SKILL.md', 'Skill fixture');
        put(repo, 'package.json', JSON.stringify({ version: release.version }));
        run('git', ['init', '-q'], repo);
        run('git', ['add', '.'], repo);
        run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Frozen package'], repo);
        release.source.revision = run('git', ['rev-parse', 'HEAD'], repo);
        put(expected, 'package.json', JSON.stringify(entry.manifest, null, 2));
        put(expected, 'bin/runweft.cjs', '#!/usr/bin/env node\n');
        run('chmod', ['755', join(expected, 'bin/runweft.cjs')], root);
        put(expected, 'README.md', 'Usage fixture');
        put(expected, 'skills/runweft-kit/SKILL.md', 'Skill fixture');
        run('npm', ['pack', '--ignore-scripts', '--pack-destination', root], expected);
        entry.sha512 = createHash('sha512').update(readFileSync(join(root, 'runweft-' + release.version + '.tgz'))).digest('base64');
        const restored = restoreMainTarball(release, join(root, 'restored'), repo);
        assert.equal(createHash('sha512').update(readFileSync(restored.tarball)).digest('base64'), entry.sha512);
        const wrong = structuredClone(release); wrong.packages.at(-1).sha512 = hash;
        assert.throws(() => restoreMainTarball(wrong, join(root, 'wrong'), repo), /differs from original/);
        writeFileSync(join(repo, 'docs/usage.md'), 'uncommitted change');
        assert.throws(() => restoreMainTarball(release, join(root, 'dirty'), repo), /Package inputs changed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
