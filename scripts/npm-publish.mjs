import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertFrozenCandidate } from './fixtures/release-inputs.mjs';

export const registry = 'https://registry.npmjs.org/';
export const packageNames = ['runweft-linux-x64', 'runweft-linux-arm64', 'runweft-darwin-x64', 'runweft-darwin-arm64', 'runweft'];

const integer = '(0|[1-9]\\d*)';
const versionPattern = new RegExp(`^${integer}\\.${integer}\\.${integer}(?:-beta\\.${integer})?$`);
function parseVersion(version) {
    const match = typeof version === 'string' && version.match(versionPattern);
    assert(match, 'Release version must be X.Y.Z or X.Y.Z-beta.N with canonical integers');
    return { core: match.slice(1, 4).map(BigInt), beta: match[4] === undefined ? null : BigInt(match[4]) };
}

export function releaseChannel(version) {
    return parseVersion(version).beta === null ? 'latest' : 'beta';
}

export function compareReleaseVersions(left, right) {
    const a = parseVersion(left), b = parseVersion(right);
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
    if (a.beta === b.beta) return 0;
    if (a.beta === null) return 1;
    if (b.beta === null) return -1;
    return a.beta > b.beta ? 1 : -1;
}

export function assertReleaseForward(version, tags, name) {
    const channels = releaseChannel(version) === 'beta' ? ['beta', 'latest'] : ['latest'];
    for (const channel of channels) if (tags[channel] != null) {
        assert(compareReleaseVersions(version, tags[channel]) >= 0,
            `${name}: release must be newer than ${channel} ${tags[channel]} (same candidate may resume)`);
    }
}

export function isRelease(env, version) {
    if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'tag') return null;
    const channel = releaseChannel(env.GITHUB_REF_NAME?.slice(1));
    assert.equal(env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match package version');
    return channel;
}

export function npmPublishArgs(entry, { dryRun, userConfig, globalConfig, cache }) {
    const args = ['publish', entry.tarball, '--registry=' + registry, '--access=public',
        '--tag=' + releaseChannel(entry.version), '--ignore-scripts', '--json', '--loglevel=error',
        `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`, `--cache=${cache}`];
    if (dryRun) args.push('--dry-run', '--force');
    return args;
}

export function validateCandidate(source, cwd = process.cwd()) {
    const index = JSON.parse(readFileSync(join(source, 'index.json'), 'utf8'));
    assertFrozenCandidate(index, cwd);
    assert.equal(index.version, JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version);
    assert.deepEqual(index.packages.map(p => p.name).sort(), [...packageNames].sort());
    const entries = packageNames.map(name => {
        const entry = index.packages.find(p => p.name === name);
        assert.equal(entry.version, index.version);
        assert.equal(entry.tarball, `tarballs/${name}-${index.version}.tgz`);
        const tarball = join(source, entry.tarball);
        assert.equal(createHash('sha512').update(readFileSync(tarball)).digest('base64'), entry.sha512, `${name}: corrupt tarball`);
        const result = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, `${name}: cannot read tarball manifest`);
        const manifest = JSON.parse(result.stdout);
        assert.equal(manifest.name, name);
        assert.equal(manifest.version, index.version);
        assert.notEqual(manifest.private, true);
        assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' });
        return { ...entry, tarball, manifest };
    });
    assert.deepEqual(entries.at(-1).manifest.optionalDependencies,
        Object.fromEntries(packageNames.filter(name => name !== 'runweft').map(name => [name, index.version])));
    return { index, entries };
}

export function checkManifest(entry, manifest) {
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);
    assert.equal(manifest.dist?.integrity, `sha512-${entry.sha512}`, `${entry.name}: published version differs; use a new version`);
    for (const key of ['os', 'cpu', 'libc', 'bin', 'engines', 'optionalDependencies', 'repository']) {
        assert.deepEqual(manifest[key], entry.manifest[key], `${entry.name}: registry ${key} differs`);
    }
}

// Persist before starting an upload so an interrupted request is never blindly repeated.
export async function publishCandidate(index, entries, { metadata, tags, upload, save, receipt = {}, pause = () => new Promise(r => setTimeout(r, 5000)), timeoutMs = 20 * 60_000 }) {
    const channel = releaseChannel(index.version);
    if (receipt.version) {
        assert.equal(receipt.version, index.version, 'Receipt version differs from candidate');
        assert.equal(receipt.sourceRevision, index.source.revision, 'Restore the original candidate for partial publication');
        assert.equal(receipt.channel, channel, 'Receipt channel differs from candidate');
    }
    const state = { ...receipt, channel, version: index.version, sourceRevision: index.source.revision, packages: receipt.packages ?? [], success: false };
    for (const record of state.packages) {
        const entry = entries.find(p => p.name === record.name);
        assert(entry && record.integrity === `sha512-${entry.sha512}`, 'Receipt integrity differs from candidate');
    }
    const recordFor = entry => state.packages.find(p => p.name === entry.name);
    function record(entry, status) {
        state.packages = state.packages.filter(p => p.name !== entry.name);
        state.packages.push({ name: entry.name, integrity: `sha512-${entry.sha512}`, status });
        save(state);
    }
    async function confirm(entry) {
        const manifest = await metadata(entry);
        if (!manifest) return false;
        checkManifest(entry, manifest);
        record(entry, 'confirmed');
        return true;
    }
    async function waitFor(entriesToWait) {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const pending = [];
            for (const entry of entriesToWait) {
                if (recordFor(entry)?.status === 'confirmed') continue;
                if (!await confirm(entry)) pending.push(entry);
            }
            if (!pending.length) return;
            assert(Date.now() < deadline, `npm processing pending for ${pending.map(p => p.name).join(', ')}; rerun failed jobs with this candidate and receipt`);
            await pause();
        }
    }
    try {
        const before = {};
        for (const entry of entries) {
            const current = await tags(entry);
            assertReleaseForward(index.version, current, entry.name);
            before[entry.name] = current.latest ?? null;
        }
        if (!state.latestBefore) {
            assert.equal(state.packages.length, 0, 'Receipt missing latest baseline; inspect original run');
            state.latestBefore = before;
        } else if (channel === 'beta') {
            assert.deepEqual(before, state.latestBefore, 'latest changed during Beta publication; inspect npm dist-tags before resuming');
        }
        save(state);
        // Check every existing version before the first upload, including the main package.
        for (const entry of entries) {
            if (await confirm(entry)) continue;
            assert.notEqual(recordFor(entry)?.status, 'uploading', `${entry.name}: upload outcome unknown; inspect npm before retry`);
            assert.notEqual(recordFor(entry)?.status, 'confirmed', `${entry.name}: confirmed version is now missing; inspect npm`);
        }
        for (const entry of entries) {
            if (entry.name === 'runweft') {
                await waitFor(entries.filter(p => p.name !== 'runweft'));
                assert.equal(state.packages.filter(p => p.name !== 'runweft' && p.status === 'confirmed').length, 4);
            }
            if (recordFor(entry)) continue;
            record(entry, 'uploading');
            const code = await upload(entry);
            if (code !== 0) {
                assert(await confirm(entry), `${entry.name}: upload outcome unknown (exit ${code}); inspect npm before retry`);
            } else record(entry, 'accepted');
        }
        await waitFor(entries);
        // Version visibility and dist-tags can propagate independently. Never upload again while waiting.
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const after = {};
            state.distTags = after;
            for (const entry of entries) {
                const current = await tags(entry);
                after[entry.name] = current;
                if (channel === 'beta') assert.equal(current.latest ?? null, state.latestBefore[entry.name],
                    `${entry.name}: latest changed during Beta publication; inspect npm dist-tags, no automatic repair`);
                if (current[channel] != null) assert(compareReleaseVersions(current[channel], index.version) <= 0,
                    `${entry.name}: ${channel} advanced beyond this candidate; inspect npm dist-tags`);
            }
            save(state);
            if (entries.every(entry => after[entry.name][channel] === index.version)) break;
            assert(Date.now() < deadline, `${channel} dist-tags pending; inspect npm dist-tags and rerun failed jobs with this receipt`);
            await pause();
        }
        state.success = true;
        return state;
    } finally {
        save(state);
    }
}

async function metadata(entry, version = entry.version) {
    const response = await fetch(`${registry}${entry.name}/${version}`, {
        headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return null;
    assert.equal(response.status, 200, `${entry.name}: npm HTTP ${response.status}`);
    return response.json();
}

async function distTags(entry) {
    const response = await fetch(`${registry}-/package/${entry.name}/dist-tags`, {
        headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return {};
    assert.equal(response.status, 200, `${entry.name}: npm dist-tags HTTP ${response.status}`);
    return response.json();
}

async function main() {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/npm-publish.mjs (mode is selected by GitHub event)');
    const { index, entries } = validateCandidate(resolve('dist/packages'));
    if (process.env.GITHUB_SHA) assert.equal(index.source.revision, process.env.GITHUB_SHA, 'Candidate must belong to this workflow commit');
    const publish = isRelease(process.env, index.version);
    const channel = releaseChannel(index.version);
    const root = resolve('.dev-smoke/npm-publish');
    mkdirSync(root, { recursive: true });
    const userConfig = join(root, 'npmrc'), globalConfig = join(root, 'npmrc-global');
    writeFileSync(userConfig, '', { mode: 0o600 }); writeFileSync(globalConfig, '', { mode: 0o600 });
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) || ['NPM_TOKEN', 'NODE_AUTH_TOKEN'].includes(key)) delete env[key];
    function npm(entry, dryRun) {
        const args = npmPublishArgs(entry, { dryRun, userConfig, globalConfig, cache: join(root, 'npm-cache') });
        const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 });
        if (result.stderr) process.stderr.write(result.stderr);
        return result;
    }
    if (!publish) {
        for (const entry of entries) {
            if (await metadata(entry)) console.log(`${entry.name}@${index.version} already published; use a new version for a release. Candidate preflight only.`);
            const result = npm(entry, true);
            assert.equal(result.status, 0, `${entry.name}: npm dry-run failed`);
            const report = JSON.parse(result.stdout);
            const packed = report[entry.name] ?? report[0];
            assert.equal(packed.integrity, `sha512-${entry.sha512}`);
            console.log(`${entry.name}@${index.version}: dry-run integrity verified`);
        }
        writeFileSync(join(root, 'preflight.json'), JSON.stringify({ source: index.source, version: index.version, channel, success: true, published: false }, null, 2));
        return;
    }
    const receiptFile = join(root, 'publication.json');
    const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : {};
    await publishCandidate(index, entries, { receipt, metadata, tags: distTags, upload: entry => npm(entry, false).status,
        save: state => writeFileSync(receiptFile, JSON.stringify(state, null, 2)) });
    console.log(`Five packages ${index.version}: public registry integrity and ${channel} dist-tags confirmed`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
