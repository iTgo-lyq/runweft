import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, cpSync, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertFrozenCandidate } from './release-inputs.mjs';
import { checkManifest, compareReleaseVersions, distTags, npmPublishArgs, packageNames,
    publishCandidate, registry, registryReaders, releaseChannel, validateCandidate } from './npm-publish.mjs';

import { publicReadBudget, publicReadError, publicResponse } from './npm-read.mjs';
import { assertCandidateBinaries } from './installed-binaries.mjs';

const delay = () => new Promise(resolve => setTimeout(resolve, 5000));
const descriptorMarker = 'RUNWEFT_RELEASE_DESCRIPTOR=';
const uploadMarker = 'RUNWEFT_UPLOAD_STARTED=';
const receiptMarker = 'RUNWEFT_PUBLICATION_STATE=';
const recoveryMarker = 'RUNWEFT_RECOVERY_SOURCE=';
function output(values) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        Object.entries(values).map(([key, value]) => key + '=' + value + '\n').join(''));
}
function report(kind, value) {
    const json = JSON.stringify(value);
    console.log('RUNWEFT_' + kind + '=' + json);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + kind + '\n\n' + json + '\n');
}
function command(program, args, options = {}) {
    const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
    assert.equal(result.status, 0, program + ' failed: ' + (result.stderr || result.signal));
    return result.stdout.trim();
}

export function assertDescriptor(release) {
    releaseChannel(release.version);
    assert.equal(release.product, 'hub-console-v1');
    assert.match(release.source.revision, /^[a-f0-9]{40}$/);
    assert.equal(release.source.dirty, false);
    assert.deepEqual(release.packages.map(p => p.name).sort(), [...packageNames].sort());
    assert.match(release.hapi.revision, /^[a-f0-9]{40}$/);
    for (const entry of release.packages) {
        assert.equal(entry.version, release.version);
        assert.equal(entry.path, entry.name);
        assert.equal(entry.tarball, 'tarballs/' + entry.name + '-' + release.version + '.tgz');
        assert.match(entry.sha512, /^[A-Za-z0-9+/]{86}==$/);
        assert.equal(entry.manifest.name, entry.name);
        assert.equal(entry.manifest.version, release.version);
        assert.notEqual(entry.manifest.private, true);
        assert.deepEqual(entry.manifest.repository, { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' });
        if (entry.name !== 'runweft') {
            assert.deepEqual(entry.manifest.runweft.hapi, release.hapi);
            for (const binary of ['bin/runweft', 'bin/hapi']) assert.match(entry.binaries[binary], /^[a-f0-9]{64}$/);
        }
        assert(Object.hasOwn(release.latestBefore, entry.name), 'Missing latest baseline: ' + entry.name);
    }
    assert.deepEqual(release.packages.find(p => p.name === 'runweft').manifest.optionalDependencies,
        Object.fromEntries(packageNames.slice(0, -1).map(name => [name, release.version])));
    return release;
}

export function readReleaseLog(log) {
    const lines = log.split('\n').filter(line => line.includes(descriptorMarker));
    const descriptors = lines.map(line => JSON.parse(line.slice(line.indexOf(descriptorMarker) + descriptorMarker.length).trim()));
    if (descriptors.length) {
        for (const descriptor of descriptors) assertDescriptor(descriptor);
        for (const descriptor of descriptors) assert.deepEqual(descriptor, descriptors[0], 'Conflicting release descriptors in source run');
    }
    const receipts = log.split('\n').filter(line => line.includes(receiptMarker))
        .map(line => JSON.parse(line.slice(line.indexOf(receiptMarker) + receiptMarker.length).trim()));
    const uploads = log.split('\n').filter(line => line.includes(uploadMarker))
        .map(line => line.slice(line.indexOf(uploadMarker) + uploadMarker.length).trim());
    return { release: descriptors[0], uploadStarted: uploads.length > 0, uploads, receipt: receipts.at(-1) };
}

export function recoveryMode(published, prior, sourceRevision, version) {
    const count = published.filter(Boolean).length;
    assert.equal(published.length, 5);
    const mainOnly = count === 4 && published.slice(0, 4).every(Boolean) && !published[4];
    if (count > 0 && count < 5 && !mainOnly) throw new Error('Partial beta publication: missing platform packages cannot be rebuilt or reuploaded.');
    if (count === 0) {
        assert(!prior.uploadStarted, 'Upload outcome unknown: do not rebuild or retry; inspect npm and the source run.');
        return 'build';
    }
    assert(prior.release, 'Published versions already exist; supply source-run-id with the original release descriptor. Never reconstruct a candidate from registry metadata.');
    assert.equal(prior.release.source.revision, sourceRevision, 'Source run belongs to a different tag commit');
    assert.equal(prior.release.version, version, 'Source run version differs');
    assert.equal(prior.prepublicationVerified, true, 'Original upload must have successful prepublication integration evidence');
    if (mainOnly) {
        const receipt = prior.receipt;
        assert(receipt, 'Partial beta publication requires the original publication receipt');
        assert.equal(receipt.version, version); assert.equal(receipt.sourceRevision, sourceRevision);
        assert.equal(receipt.channel, 'beta'); assert.deepEqual(receipt.latestBefore, prior.release.latestBefore);
        assert.equal(new Set(receipt.packages.map(p => p.name)).size, receipt.packages.length, 'Duplicate receipt packages');
        for (const record of receipt.packages) {
            const entry = prior.release.packages.find(p => p.name === record.name);
            assert(entry && record.integrity === 'sha512-' + entry.sha512, 'Receipt integrity differs');
            assert(['accepted', 'confirmed'].includes(record.status), 'Upload outcome unknown; inspect npm before retry');
        }
        for (let i = 0; i < 4; i++) {
            const entry = prior.release.packages.find(p => p.name === packageNames[i]);
            checkManifest(entry, published[i]);
            assert(receipt.packages.some(p => p.name === entry.name), 'Missing platform upload receipt');
        }
        assert(!prior.uploads?.includes('runweft') || receipt.packages.some(p => p.name === 'runweft'), 'Main upload outcome unknown');
        return 'main-only';
    }
    return 'existing';
}

export function releaseChecks(version, publishing, mode) {
    assert(['build', 'existing', 'main-only'].includes(mode), 'Unknown release mode');
    const stable = releaseChannel(version) === 'latest';
    return { publicIntegration: publishing && (stable || mode !== 'build'),
        inlineIntegration: !(publishing && stable),
        siteInstall: publishing && stable };
}

export function unpackRelease(release, directory, platform = process.platform + '-' + process.arch) {
    assertDescriptor(release);
    const entry = release.packages.find(entry => entry.name === 'runweft-' + platform);
    assert(entry, 'Unsupported candidate platform');
    const tarball = join(directory, entry.tarball), destination = join(directory, entry.path);
    assert.equal(createHash('sha512').update(readFileSync(tarball)).digest('base64'), entry.sha512, 'Candidate archive changed before extraction');
    mkdirSync(destination, { recursive: true });
    command('tar', ['-xzf', tarball, '--strip-components=1', '-C', destination]);
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'package.json'))), entry.manifest);
    const binary = join(destination, 'bin/runweft');
    const binaries = assertCandidateBinaries(binary, Object.fromEntries(['runweft', 'hapi'].map(name =>
        [name, { sha256: entry.binaries['bin/' + name] }])));
    return { binary, binaries };
}

export async function verifyPublicRelease(release, { read, request = fetch, pause, timeoutMs = 180_000,
    budget = publicReadBudget({ timeoutMs, pause }) } = {}) {
    assertDescriptor(release);
    const entries = await Promise.all(release.packages.map(entry => budget(entry.name + ':metadata', async signal => {
        const manifest = read ? await read(entry, { signal })
            : await (await publicResponse(request, registry + entry.name + '/' + entry.version, signal)).json();
        if (!manifest) throw publicReadError(404);
        checkManifest(entry, manifest);
        return [entry.name, manifest];
    })));
    return new Map(entries);
}

export async function downloadRelease(release, directory, { read, request = fetch,
    platform = process.platform + '-' + process.arch, timeoutMs = 600_000, pause, now,
    record = () => {} } = {}) {
    assertDescriptor(release);
    assert(release.packages.some(entry => entry.name === 'runweft-' + platform), 'Unsupported candidate platform');
    const budget = publicReadBudget({ timeoutMs, pause, now, record });
    const manifests = await verifyPublicRelease(release, { read, request, budget });
    mkdirSync(join(directory, 'tarballs'), { recursive: true });
    for (const entry of release.packages) {
        mkdirSync(join(directory, entry.path), { recursive: true });
        writeFileSync(join(directory, entry.path, 'package.json'), JSON.stringify(entry.manifest));
        if (!['runweft', 'runweft-' + platform].includes(entry.name)) continue;
        const url = new URL(manifests.get(entry.name).dist.tarball);
        assert(url.href.startsWith(registry + entry.name + '/-/') && !url.username && !url.password, 'Tarball must be served by public npm');
        const destination = join(directory, entry.tarball), temporary = destination + '.partial';
        await budget(entry.name + ':tarball', async signal => {
            try {
                const response = await publicResponse(request, url, signal);
                const hash = createHash('sha512');
                await pipeline(response.body, new Transform({ transform(chunk, _, done) { hash.update(chunk); done(null, chunk); } }),
                    createWriteStream(temporary), { signal });
                assert.equal(hash.digest('base64'), entry.sha512, entry.name + ': downloaded tarball differs');
                renameSync(temporary, destination);
            } finally { rmSync(temporary, { force: true }); }
        });
    }
    writeFileSync(join(directory, 'index.json'), JSON.stringify(release));
    return directory;
}

export async function promoteRelease(release, { installationResult, betaResult, integrationResult, validationMode,
    read, tags = distTags, setTag,
    pause = delay, timeoutMs = 3 * 60_000 }) {
    assert.equal(installationResult, 'success', 'All four native installation jobs must succeed before promotion');
    assert.equal(betaResult, 'success', 'Beta prepublication checks must succeed');
    assert(['public', 'inline'].includes(validationMode), 'Missing release validation mode');
    if (releaseChannel(release.version) === 'latest') assert.equal(validationMode, 'public', 'Stable releases require public candidate integration');
    assert.equal(integrationResult, validationMode === 'public' ? 'success' : 'skipped', 'Required candidate integration did not succeed');
    await verifyPublicRelease(release, { read, pause, timeoutMs });
    if (releaseChannel(release.version) === 'beta') return { version: release.version, channel: 'beta', promoted: false, success: true };
    const entries = packageNames.map(name => release.packages.find(p => p.name === name));
    async function inspect(entry) {
        const current = await tags(entry);
        assert.equal(current.beta, release.version, entry.name + ': beta changed; inspect dist-tags');
        if (current.latest !== release.version) {
            assert.equal(current.latest ?? null, release.latestBefore[entry.name], entry.name + ': latest changed outside this release');
            if (current.latest) assert(compareReleaseVersions(current.latest, release.version) < 0, entry.name + ': never regress latest');
        }
        return current;
    }
    // Inspect all five packages before the first mutation; main advances only after every platform.
    await Promise.all(entries.map(inspect));
    const finalTags = {};
    for (const entry of entries) {
        const current = await inspect(entry);
        if (current.latest !== release.version) await setTag(entry, 'latest');
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const after = await inspect(entry);
            if (after.latest === release.version) { finalTags[entry.name] = after; break; }
            assert(Date.now() < deadline, entry.name + ': latest propagation pending; rerun promotion, never reupload');
            await pause();
        }
    }
    return { version: release.version, source: release.source, channel: 'latest', promoted: true, success: true, distTags: finalTags };
}

export async function downloadJobLog(repository, jobId, { token = process.env.GH_TOKEN, request = fetch } = {}) {
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(String(jobId), /^\d+$/);
    assert(token, 'GH_TOKEN is required to read the source workflow log');
    // Capture the REST log as data; gh's terminal escape filter rejects ordinary runner ANSI output.
    const response = await request('https://api.github.com/repos/' + repository + '/actions/jobs/' + jobId + '/logs', {
        redirect: 'manual', signal: AbortSignal.timeout(60_000),
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 302, 'Source job log redirect HTTP ' + response.status);
    const location = response.headers.get('location');
    assert(location, 'Source job log redirect missing');
    const url = new URL(location);
    assert(url.protocol === 'https:' && !url.username && !url.password, 'Invalid source job log redirect');
    // The signed download is anonymous. Never forward the GitHub credential or print the URL/log.
    const download = await request(url, { signal: AbortSignal.timeout(60_000) });
    assert.equal(download.status, 200, 'Source job log download HTTP ' + download.status);
    return download.text();
}

export async function previousRunLog(env, { query = path => JSON.parse(command('gh', ['api', path])),
    readLog = downloadJobLog } = {}) {
    const id = env.SOURCE_RUN_ID || env.GITHUB_RUN_ID;
    assert.match(id ?? '', /^\d+$/);
    assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    let log = '', prepublicationVerified = false;
    const visited = new Set(), active = new Set();
    async function collect(id) {
        assert.match(String(id), /^[1-9]\d*$/);
        assert(!active.has(id), 'Recovery source cycle');
        if (visited.has(id)) return;
        assert(visited.size + active.size < 20, 'Recovery source chain too long');
        active.add(id);
        const base = 'repos/' + env.GITHUB_REPOSITORY + '/actions/runs/' + id;
        const info = await query(base);
        assert.equal(info.path, '.github/workflows/npm-publish.yml', 'Source run must use npm-publish.yml in this repository');
        const attempts = id === env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ATTEMPT) - 1 : info.run_attempt;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const jobs = (await query(base + '/attempts/' + attempt + '/jobs?per_page=100')).jobs;
            for (const job of jobs.filter(job => job.name === 'beta')) {
                const part = await readLog(env.GITHUB_REPOSITORY, job.id, { token: env.GH_TOKEN });
                for (const line of part.split('\n').filter(line => line.includes(recoveryMarker))) {
                    await collect(line.slice(line.indexOf(recoveryMarker) + recoveryMarker.length).trim());
                }
                if (readReleaseLog(part).uploadStarted && job.steps?.some(step =>
                    step.name === 'Check every model-free integration group on the frozen candidate' && step.conclusion === 'success')) prepublicationVerified = true;
                log += part + '\n';
            }
        }
        active.delete(id); visited.add(id);
    }
    await collect(id);
    if (id !== env.GITHUB_RUN_ID && Number(env.GITHUB_RUN_ATTEMPT) > 1) await collect(env.GITHUB_RUN_ID);
    return { ...readReleaseLog(log), prepublicationVerified };
}

// Recover only the source-only launcher archive, then require the original CI byte digest.
// Compiled platform packages are never reconstructed by this path.
export function restoreMainTarball(release, directory, cwd = process.cwd()) {
    assertDescriptor(release); assertFrozenCandidate(release, cwd);
    const entry = release.packages.find(p => p.name === 'runweft');
    const source = join(directory, 'source'), main = join(directory, 'runweft'), tarballs = join(directory, 'tarballs');
    for (const path of [source, join(main, 'bin'), tarballs]) mkdirSync(path, { recursive: true });
    const archive = join(directory, 'source.tar');
    command('git', ['archive', '--format=tar', '--output', archive, release.source.revision, '--',
        'src/npm-launcher.cjs', 'docs/usage.md', '.agents/skills/runweft-kit'], { cwd });
    command('tar', ['-xf', archive, '-C', source]);
    copyFileSync(join(source, 'src/npm-launcher.cjs'), join(main, 'bin/runweft.cjs'));
    chmodSync(join(main, 'bin/runweft.cjs'), 0o755);
    copyFileSync(join(source, 'docs/usage.md'), join(main, 'README.md'));
    cpSync(join(source, '.agents/skills/runweft-kit'), join(main, 'skills/runweft-kit'), { recursive: true });
    writeFileSync(join(main, 'package.json'), JSON.stringify(entry.manifest, null, 2));
    command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], { cwd: main });
    const tarball = join(directory, entry.tarball);
    assert.equal(createHash('sha512').update(readFileSync(tarball)).digest('base64'), entry.sha512,
        'Restored main tarball differs from original candidate; do not upload');
    return { ...entry, tarball };
}

export async function prepareVerification(env, { load = previousRunLog, verify = verifyPublicRelease, checkInputs = assertFrozenCandidate } = {}) {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Public verification requires an explicit dispatch');
    assert(!env.RELEASE_TAG && !env.SOURCE_RUN_ID, 'verify-run-id cannot be combined with publishing/recovery inputs');
    assert.match(env.VERIFY_RUN_ID ?? '', /^[1-9]\d*$/);
    const prior = await load({ ...env, SOURCE_RUN_ID: env.VERIFY_RUN_ID });
    assert(prior.release && prior.prepublicationVerified, 'Verification requires the original candidate and successful prepublication checks');
    const release = assertDescriptor(prior.release);
    checkInputs(release); // Exact package inputs must still match; only verification/control code may differ.
    await verify(release);
    return { 'source-ref': release.source.revision, publish: false, build: false, 'verify-only': true,
        'public-integration': true, 'validation-mode': 'public', 'site-install': releaseChannel(release.version) === 'latest',
        release: JSON.stringify(release) };
}

async function prepare(env) {
    if (env.VERIFY_RUN_ID) {
        const plan = await prepareVerification(env);
        output(plan); console.log(descriptorMarker + plan.release);
        report('RELEASE_PLAN', { sourceRunId: env.VERIFY_RUN_ID, controlRevision: env.GITHUB_SHA, mode: 'verify-only', publishing: false });
        return;
    }
    const publishing = Boolean(env.RELEASE_TAG);
    if (env.GITHUB_EVENT_NAME === 'push') {
        assert.equal(env.GITHUB_REF_TYPE, 'tag');
        assert.equal(env.RELEASE_TAG, env.GITHUB_REF_NAME);
    } else {
        assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
        if (publishing) assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Release recovery must run the main workflow');
    }
    if (publishing) releaseChannel(env.RELEASE_TAG.slice(1));
    const revision = command('git', ['rev-parse', '--verify', (env.RELEASE_TAG || env.GITHUB_SHA) + '^{commit}']);
    const pkg = JSON.parse(command('git', ['show', revision + ':package.json']));
    if (publishing) assert.equal(env.RELEASE_TAG, 'v' + pkg.version, 'Tag must match source version');
    assert.equal(pkg.packageManager, 'bun@1.4.2', 'Release toolchain differs');
    assert.equal(command('git', ['rev-parse', revision + ':hapi']), pkg.hapi.revision, 'HAPI gitlink differs');
    assertFrozenCandidate({ source: { revision, dirty: false } });
    let prior = {};
    if (publishing && (env.SOURCE_RUN_ID || Number(env.GITHUB_RUN_ATTEMPT) > 1)) {
        if (env.SOURCE_RUN_ID) console.log(recoveryMarker + env.SOURCE_RUN_ID);
        prior = await previousRunLog(env);
    }
    const reads = registryReaders();
    const manifests = publishing ? await Promise.all(packageNames.map(name => reads.metadata({ name, version: pkg.version }))) : Array(5).fill(null);
    const mode = recoveryMode(manifests, prior, revision, pkg.version);
    const checks = releaseChecks(pkg.version, publishing, mode);
    if (mode !== 'build') {
        assert.deepEqual(prior.release.hapi, pkg.hapi);
        console.log(descriptorMarker + JSON.stringify(prior.release));
        if (mode === 'main-only') {
            assert(env.RUNWEFT_WORK_DIR, 'Set RUNWEFT_WORK_DIR for main recovery');
            const main = restoreMainTarball(prior.release, resolve(env.RUNWEFT_WORK_DIR, 'main-recovery'));
            const npm = npmRunner();
            await publishCandidate(prior.release, packageNames.map(name => name === 'runweft' ? main : prior.release.packages.find(p => p.name === name)), {
                channel: 'beta', receipt: prior.receipt,
                upload: entry => {
                    assert.equal(entry.name, 'runweft', 'Recovery must never upload a platform package');
                    console.log(uploadMarker + entry.name);
                    try { npm.publish(entry, false); return 0; } catch (error) { console.error(error.message); return 1; }
                }, save: state => report('PUBLICATION_STATE', state),
            });
        }
        await verifyPublicRelease(prior.release);
    }
    output({ 'source-ref': revision, publish: publishing, build: mode === 'build', 'verify-only': false,
        'public-integration': checks.publicIntegration, 'inline-integration': checks.inlineIntegration,
        'validation-mode': checks.publicIntegration ? 'public' : 'inline', 'site-install': checks.siteInstall,
        release: mode !== 'build' ? JSON.stringify(prior.release) : '' });
    report('RELEASE_PLAN', { tag: env.RELEASE_TAG || null, sourceRevision: revision, controlRevision: env.GITHUB_SHA, mode, publishing });
}

function npmRunner() {
    assert(process.env.RUNWEFT_WORK_DIR, 'Set RUNWEFT_WORK_DIR to this operation’s private directory');
    const root = resolve(process.env.RUNWEFT_WORK_DIR, 'npm');
    mkdirSync(root, { recursive: true });
    const config = { userConfig: join(root, 'npmrc'), globalConfig: join(root, 'npmrc-global'), cache: join(root, 'npm-cache') };
    for (const path of [config.userConfig, config.globalConfig]) writeFileSync(path, '', { mode: 0o600 });
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) || ['NPM_TOKEN', 'NODE_AUTH_TOKEN'].includes(key)) delete env[key];
    return {
        publish(entry, dryRun) {
            return command('npm', npmPublishArgs(entry, { ...config, dryRun, channel: 'beta' }), { env, timeout: 10 * 60_000 });
        },
        setTag(entry, tag) {
            try { command('npm', ['dist-tag', 'add', entry.name + '@' + entry.version, tag, '--registry=' + registry,
                '--userconfig=' + config.userConfig, '--globalconfig=' + config.globalConfig, '--cache=' + config.cache,
                '--loglevel=error'], { env, timeout: 2 * 60_000 }); }
            catch (error) {
                throw new Error(error.message + '\nEnable Allow npm dist-tag for npm-publish.yml at ' +
                    'https://www.npmjs.com/package/' + entry.name + '/access (keep npm publish allowed). Then rerun only promotion.');
            }
        },
    };
}

async function beta(env) {
    assert.notEqual(env.VERIFY_ONLY, 'true', 'Read-only verification cannot upload or promote packages');
    assert(env.RELEASE_SOURCE, 'Set RELEASE_SOURCE to the frozen source checkout');
    const source = resolve(env.RELEASE_SOURCE);
    const { index, entries } = validateCandidate(join(source, 'dist/packages'), source);
    assert.equal(index.source.revision, env.SOURCE_REVISION, 'Candidate source differs from selected tag');
    const latestBefore = {};
    await Promise.all(entries.map(async entry => {
        const current = await distTags(entry);
        if (current.beta) assert(compareReleaseVersions(current.beta, index.version) <= 0, entry.name + ': never regress beta');
        latestBefore[entry.name] = current.latest ?? null;
    }));
    const release = assertDescriptor({ ...index, controlRevision: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, latestBefore,
        packages: index.packages.map(entry => ({ ...entry, manifest: entries.find(p => p.name === entry.name).manifest })) });
    console.log(descriptorMarker + JSON.stringify(release));
    const npm = npmRunner();
    if (env.PUBLISH_RELEASE !== 'true') {
        for (const entry of entries) {
            const dryRun = JSON.parse(npm.publish(entry, true));
            assert.equal((dryRun[entry.name] ?? dryRun[0])?.integrity, 'sha512-' + entry.sha512, entry.name + ': dry-run integrity differs');
        }
        report('PREFLIGHT', { version: index.version, source: index.source, success: true, published: false });
        return;
    }
    await publishCandidate(index, entries, {
        channel: 'beta',
        receipt: { version: index.version, sourceRevision: index.source.revision, channel: 'beta', latestBefore, packages: [] },
        upload: entry => {
            console.log(uploadMarker + entry.name);
            try { npm.publish(entry, false); return 0; } catch (error) { console.error(error.message); return 1; }
        },
        save: state => report('PUBLICATION_STATE', state),
    });
    await verifyPublicRelease(release);
    output({ release: JSON.stringify(release) });
}

async function main() {
    switch (process.argv[2]) {
        case 'prepare': await prepare(process.env); break;
        case 'beta': await beta(process.env); break;
        case 'download': {
            const release = JSON.parse(process.env.RELEASE_DESCRIPTOR);
            assert(process.env.RUNWEFT_WORK_DIR, 'Set RUNWEFT_WORK_DIR');
            const directory = await downloadRelease(release, resolve(process.env.RUNWEFT_WORK_DIR, 'candidate'), { record: item => report('PUBLIC_READ', item) });
            output({ directory }); break;
        }
        case 'unpack': {
            const release = JSON.parse(process.env.RELEASE_DESCRIPTOR);
            const result = unpackRelease(release, resolve(process.env.CANDIDATE_DIRECTORY));
            output({ binary: result.binary }); report('INTEGRATION_CANDIDATE', { ...result, version: release.version,
                source: release.source, controlRevision: process.env.GITHUB_SHA }); break;
        }
        case 'promote': {
            assert.notEqual(process.env.VERIFY_ONLY, 'true', 'Read-only verification cannot upload or promote packages');
            const release = JSON.parse(process.env.RELEASE_DESCRIPTOR);
            const npm = npmRunner();
            report('PROMOTION', await promoteRelease(release, { installationResult: process.env.INSTALL_RESULT,
                betaResult: process.env.BETA_RESULT, integrationResult: process.env.INTEGRATION_RESULT,
                validationMode: process.env.VALIDATION_MODE, setTag: npm.setTag }));
            break;
        }
        default: throw new Error('Usage: node scripts/npm-release.mjs prepare|beta|download|promote');
    }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
