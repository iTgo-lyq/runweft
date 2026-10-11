import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { assertDescriptor, downloadRelease, promoteRelease, readReleaseLog, recoveryMode, verifyPublicRelease } from '../npm-release.mjs';
import { npmPublishArgs, packageNames, publishCandidate, registry } from '../npm-publish.mjs';

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
        installationResult: 'success', read: async entry => publicManifest(entry),
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
    assert.equal(recoveryMode(Array(5).fill({}), { release }, source, version), 'existing');
    const log = '2026-10-11T00:00:00Z RUNWEFT_RELEASE_DESCRIPTOR=' + JSON.stringify(release) + '\nRUNWEFT_UPLOAD_STARTED=runweft-linux-x64\n';
    assert.deepEqual(readReleaseLog(log), { release, uploadStarted: true });
    const bad = structuredClone(release); bad.packages[0].path = '../escape';
    assert.throws(() => assertDescriptor(bad));
});

test('four native job failures prevent promotion before any public check or mutation', async () => {
    for (const installationResult of ['failure', 'cancelled', 'skipped', '']) {
        await assert.rejects(promoteRelease(descriptor(), { installationResult, read() { throw new Error('Unexpected request'); } }), /four native/);
    }
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
    assert.equal(reads, 10); assert.equal(pauses, 1);
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
    assert.deepEqual(publish.jobs.promote.needs, ['beta', 'install']);
    assert.match(publish.jobs.promote.if, /needs\.install\.result == 'success'/);
    assert.equal(publish.concurrency.group, 'npm-publish'); assert.equal(publish.concurrency['cancel-in-progress'], false);
    const sourceCheckout = publish.jobs.beta.steps.find(step => step.name === 'Check out exact tag source for packaging');
    const integration = publish.jobs.beta.steps.find(step => step.name === 'Check every model-free integration group on the frozen candidate');
    const candidateDirectory = sourceCheckout.with.path + '/dist/packages';
    assert.equal(integration.env.RUNWEFT_SMOKE_PACKAGES, candidateDirectory);
    assert(integration.run.includes(candidateDirectory + '/runweft-linux-x64/bin/runweft'));
    assert.deepEqual(install.jobs.install.strategy.matrix.include.map(row => row.platform).sort(),
        ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
    assert.equal(install.permissions['id-token'], undefined);
    assert.equal(install.jobs.install['continue-on-error'], undefined);
});
