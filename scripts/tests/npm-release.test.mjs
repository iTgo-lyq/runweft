import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { assertDescriptor, downloadJobLog, downloadRelease, promoteRelease, previousRunLog, readReleaseLog, recoveryMode, releaseChecks, unpackRelease, verifyPublicRelease } from '../npm-release.mjs';
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

test('recovery refuses partial, unknown, missing provenance log and wrong source candidates', () => {
    const release = descriptor(), source = release.source.revision, version = release.version;
    assert.equal(recoveryMode(Array(5).fill(null), {}, source, version), 'build');
    assert.throws(() => recoveryMode(Array(5).fill(null), { uploadStarted: true }, source, version), /outcome unknown/);
    assert.throws(() => recoveryMode([{}, null, null, null, null], {}, source, version), /Partial beta/);
    assert.throws(() => recoveryMode(Array(5).fill({}), {}, source, version), /source-run-id/);
    assert.throws(() => recoveryMode(Array(5).fill({}), { release }, 'f'.repeat(40), version), /different tag/);
    assert.equal(recoveryMode(Array(5).fill({}), { release, prepublicationVerified: true }, source, version), 'existing');
    const log = '2026-10-11T00:00:00Z RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft-linux-x64\n';
    assert.deepEqual(readReleaseLog(log), { release, uploadStarted: true });
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
    assert.deepEqual(readReleaseLog(recovered), { release, uploadStarted: true });
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
        groups: ['access', 'storage', 'web', 'service-package'], siteInstall: false });
    assert.equal(releaseChecks('1.2.0-beta.1', true, 'build').publicIntegration, false);
    assert.deepEqual(releaseChecks('1.2.0', true, 'build').groups, ['service-package']);
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
                paths.push(path); assert(path.startsWith('repos/owner/repo/actions/runs/' + original));
                return path.endsWith('/jobs?per_page=100') ? { jobs: [{ name: 'beta', id: 1, steps: [{
                    name: 'Check every model-free integration group on the frozen candidate', conclusion: 'success',
                }] }] } : { path: '.github/workflows/npm-publish.yml', run_attempt: 1 };
            }, readLog: async () => 'RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft',
        };
        const prior = await previousRunLog(env, options);
        assert.equal(recoveryMode(Array(5).fill({}), prior, release.source.revision, release.version), 'existing');
        assert.equal(releaseChecks(release.version, true, 'existing').publicIntegration, true);
        assert.equal(paths.length, 2);
        const missing = await previousRunLog(env, { ...options, query: async path => {
            const value = await options.query(path); if (value.jobs) value.jobs[0].steps[0].conclusion = 'skipped'; return value;
        } });
        assert.throws(() => recoveryMode(Array(5).fill({}), missing, release.source.revision, release.version), /prepublication/);
    }
});

test('public integration extracts the bound archive and rejects either changed program', () => {
    const directory = mkdtempSync(resolve('.dev-smoke/unpack-candidate-'));
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
    const directory = mkdtempSync(resolve('.dev-smoke/public-candidate-test-'));
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
    const sourceCheckout = publish.jobs.beta.steps.find(step => step.name === 'Check out exact tag source for packaging');
    const integration = publish.jobs.beta.steps.find(step => step.name === 'Check every model-free integration group on the frozen candidate');
    const candidateDirectory = sourceCheckout.with.path + '/dist/packages';
    assert.equal(integration.env.RUNWEFT_SMOKE_PACKAGES, candidateDirectory);
    assert(integration.run.includes(candidateDirectory + '/runweft-linux-x64/bin/runweft'));
    const installationRows = install.jobs.install.strategy.matrix.include;
    assert.deepEqual([...new Set(installationRows.map(row => row.platform))].sort(),
        ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
    for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
        const checks = installationRows.filter(row => row.platform === platform)
            .flatMap(row => row.check === 'both' ? ['install', 'uninstall'] : [row.check]);
        assert.deepEqual(checks.sort(), ['install', 'uninstall'], platform + ': both acceptance paths are mandatory, exactly once');
    }
    assert.equal(install.jobs.install.steps.find(step => step.run?.includes('node scripts/smoke-install.mjs')).if, "matrix.check != 'uninstall'");
    assert.equal(install.jobs.install.steps.find(step => step.run?.includes('node scripts/smoke-uninstall.mjs')).if, "matrix.check != 'install'");
    assert.equal(install.permissions['id-token'], undefined);
    assert.equal(install.jobs.install['continue-on-error'], undefined);
    assert.deepEqual(publish.jobs.integration.strategy.matrix.include.map(row => row.group + ':' + row.shard).sort(),
        ['access:1/2', 'access:2/2', 'storage:1/3', 'storage:2/3', 'storage:3/3', 'web:1/1']);
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
    const directory = mkdtempSync(resolve('.dev-smoke/public-retry-'));
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
        const directory = mkdtempSync(resolve('.dev-smoke/public-refusal-'));
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
