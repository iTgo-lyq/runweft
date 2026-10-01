import { expect, test } from 'bun:test';
import { packageNames, isRelease, publishCandidate, checkManifest, releaseChannel, compareReleaseVersions, assertReleaseForward, npmPublishArgs } from '../scripts/npm-publish.mjs';
import { checkNpmTrust } from '../scripts/check-npm-trust.mjs';

const index = { version: '1.2.0', source: { revision: 'a'.repeat(40) } };
const entries = packageNames.map(name => ({ name, version: index.version, sha512: name,
    manifest: { name, version: index.version, repository: { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' } } }));
const publicManifest = entry => ({ ...entry.manifest, dist: { integrity: `sha512-${entry.sha512}` } });
const publish = options => publishCandidate(index, entries, {
    tags: async entry => ({ latest: await options.metadata(entry) ? index.version : '1.1.0' }), ...options,
});


test('only a push of the matching stable version tag can publish', () => {
    const tag = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.0' };
    expect(isRelease(tag, index.version)).toBe('latest');
    expect(isRelease({ ...tag, GITHUB_EVENT_NAME: 'workflow_dispatch' }, index.version)).toBe(null);
    expect(isRelease({ ...tag, GITHUB_REF_TYPE: 'branch' }, index.version)).toBe(null);
    expect(isRelease({}, index.version)).toBe(null);
    expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'v1.2.1' }, index.version)).toThrow('match package');
    expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'v1.2.0-beta' }, index.version)).toThrow('canonical integers');
});

test('a conflicting main version stops before any platform upload', async () => {
    const uploads = [];
    await expect(publish({ metadata: async entry => entry.name === 'runweft' ?
        { ...publicManifest(entry), dist: { integrity: 'different' } } : null,
    upload: async entry => uploads.push(entry.name), save() {} })).rejects.toThrow('published version differs');
    expect(uploads).toEqual([]);
});

test('accepted platform uploads are confirmed before the main package', async () => {
    const uploads = [], publicPackages = new Set();
    let saved;
    const result = await publish({
        metadata: async entry => publicPackages.has(entry.name) ? publicManifest(entry) : null,
        upload: async entry => {
            expect(saved.packages.find(p => p.name === entry.name).status).toBe('uploading');
            if (entry.name === 'runweft') expect(publicPackages.size).toBe(4);
            uploads.push(entry.name);
            return 0;
        },
        pause: async () => { for (const name of uploads) publicPackages.add(name); },
        save: state => { saved = structuredClone(state); },
    });
    expect(result.success).toBe(true);
    expect(uploads).toEqual(packageNames);
    expect(result.packages.every(p => p.status === 'confirmed')).toBe(true);
});

test('pending processing retains receipts and a retry never reuploads accepted packages', async () => {
    let saved;
    const uploads = [];
    await expect(publish({ metadata: async () => null,
        upload: async entry => { uploads.push(entry.name); return 0; },
        timeoutMs: 0, save: state => { saved = structuredClone(state); },
    })).rejects.toThrow('processing pending');
    expect(uploads).toEqual(packageNames.slice(0, 4));
    expect(saved.packages.every(p => p.status === 'accepted')).toBe(true);
    const resumedUploads = [];
    const result = await publish({ receipt: saved,
        metadata: async entry => entry.name !== 'runweft' || resumedUploads.length ? publicManifest(entry) : null,
        upload: async entry => { resumedUploads.push(entry.name); return 0; }, save() {},
    });
    expect(result.success).toBe(true);
    expect(resumedUploads).toEqual(['runweft']);
});

test('unknown upload outcome remains blocked until public npm proves its integrity', async () => {
    let saved;
    await expect(publish({ metadata: async () => null, upload: async () => 1,
        save: state => { saved = structuredClone(state); },
    })).rejects.toThrow('outcome unknown');
    expect(saved.packages[0].status).toBe('uploading');
    let calls = 0;
    await expect(publish({ receipt: saved, metadata: async () => null,
        upload: async () => { calls++; }, save() {},
    })).rejects.toThrow('outcome unknown');
    expect(calls).toBe(0);
    const result = await publish({ receipt: saved, metadata: async entry => publicManifest(entry),
        upload: async () => { calls++; }, save() {},
    });
    expect(result.success).toBe(true);
    expect(calls).toBe(0);
});

test('receipt source and metadata dependencies must match the same candidate', async () => {
    await expect(publish({ receipt: { version: index.version, sourceRevision: 'b'.repeat(40) },
        metadata: async () => null, upload() {}, save() {},
    })).rejects.toThrow('original candidate');
    expect(() => checkManifest(entries[0], { ...publicManifest(entries[0]), optionalDependencies: { unexpected: '1' } })).toThrow('optionalDependencies differs');
});

test('OIDC exchanges all five package tokens without retaining any credentials', async () => {
    const requests = [];
    const report = await checkNpmTrust({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/id?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' },
        async (url, options) => {
            requests.push({ url: String(url), options });
            return { ok: true, status: requests.length === 1 ? 200 : 201,
                json: async () => requests.length === 1 ? { value: 'id-secret' } : { token: 'npm-secret' } };
        });
    expect(requests[0].url).toContain('audience=npm%3Aregistry.npmjs.org');
    expect(requests.slice(1).map(r => r.url.split('/').at(-1))).toEqual(packageNames);
    expect(requests.slice(1).every(r => r.options.method === 'POST' && r.options.headers.Authorization === 'Bearer id-secret')).toBe(true);
    expect(report.success).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/request-secret|id-secret|npm-secret/);
});

test('an OIDC rejection reports only the package and status, never a response token', async () => {
    let calls = 0;
    await expect(checkNpmTrust({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/id', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret' },
        async () => ++calls === 1 ? { ok: true, status: 200, json: async () => ({ value: 'secret' }) } :
            { ok: false, status: 403, json: async () => { throw new Error('Never read rejected response'); } },
    )).rejects.toThrow('npm OIDC HTTP 403');
    expect(calls).toBe(2);
});

test('canonical Beta tags publish beta; branch and manual events never publish', () => {
    const version = '1.2.0-beta.1', tag = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v' + version };
    expect(isRelease(tag, version)).toBe('beta');
    expect(isRelease({ ...tag, GITHUB_EVENT_NAME: 'workflow_dispatch' }, version)).toBe(null);
    expect(isRelease({ ...tag, GITHUB_REF_TYPE: 'branch' }, version)).toBe(null);
    expect(() => isRelease(tag, '1.2.0-beta.2')).toThrow('match package');
    for (const bad of ['1.2.0-beta', '1.2.0-beta.-1', '1.2.0-beta.01', '01.2.0', '1.2.0-rc.1', '1.2.0-alpha.1', '1.2.0+build', '1.2.0-beta.1.extra']) {
        expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'v' + bad }, bad)).toThrow('canonical integers');
    }
    expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'x' + version }, version)).toThrow('match package');
    expect(releaseChannel('0.0.0-beta.0')).toBe('beta');
});

test('version ordering compares numeric Beta sequences and stable precedence', () => {
    for (const [next, previous] of [['1.2.0-beta.10', '1.2.0-beta.2'], ['1.2.0', '1.2.0-beta.999'],
        ['1.2.1-beta.0', '1.2.0'], ['2.0.0-beta.0', '1.99.99'], ['1.2.123456789012345678901', '1.2.123456789012345678900']]) {
        expect(compareReleaseVersions(next, previous)).toBe(1);
        expect(compareReleaseVersions(previous, next)).toBe(-1);
        expect(compareReleaseVersions(next, next)).toBe(0);
    }
});

test('Beta advances beyond both beta and latest; stable ignores a newer beta channel', () => {
    expect(() => assertReleaseForward('1.1.1-beta.9', { latest: '1.1.1' }, 'runweft')).toThrow('latest');
    expect(() => assertReleaseForward('1.2.0-beta.2', { latest: '1.1.1', beta: '1.2.0-beta.10' }, 'runweft')).toThrow('beta');
    assertReleaseForward('1.2.0-beta.10', { latest: '1.1.1', beta: '1.2.0-beta.10' }, 'runweft');
    assertReleaseForward('1.2.0', { latest: '1.1.1', beta: '2.0.0-beta.1' }, 'runweft');
});

const config = { userConfig: 'isolated/npmrc', globalConfig: 'isolated/global', cache: 'isolated/cache' };
test('dry-run and upload share explicit beta/latest parameters and isolated configs', () => {
    for (const version of ['1.2.0', '1.2.0-beta.1']) for (const dryRun of [true, false]) {
        const args = npmPublishArgs({ version, tarball: 'candidate.tgz' }, { ...config, dryRun });
        expect(args).toContain('--tag=' + (version.includes('-beta.') ? 'beta' : 'latest'));
        expect(args.filter(arg => arg.startsWith('--tag='))).toHaveLength(1);
        expect(args.includes('--dry-run')).toBe(dryRun);
        expect(args.includes('--force')).toBe(dryRun);
        expect(args).toContain('--ignore-scripts');
        expect(args).toContain('--userconfig=isolated/npmrc');
    }
});

const betaIndex = { ...index, version: '1.2.0-beta.1' };
const betaEntries = entries.map(entry => ({ ...entry, version: betaIndex.version, manifest: { ...entry.manifest, version: betaIndex.version,
    ...(entry.name === 'runweft' ? { optionalDependencies: Object.fromEntries(packageNames.slice(0, 4).map(name => [name, betaIndex.version])) } : {}) } }));

test('Beta uploads preserve actual latest and record channel, baseline and final dist-tags', async () => {
    const published = new Set(), uploads = [], tags = Object.fromEntries(packageNames.map(name => [name, { latest: '1.1.1' }]));
    const result = await publishCandidate(betaIndex, betaEntries, {
        metadata: async entry => published.has(entry.name) ? publicManifest(entry) : null,
        tags: async entry => ({ ...tags[entry.name] }), save() {},
        upload: async entry => {
            expect(npmPublishArgs(entry, { ...config, dryRun: false })).toContain('--tag=beta');
            if (entry.name === 'runweft') expect(published.size).toBe(4);
            uploads.push(entry.name);published.add(entry.name);tags[entry.name].beta = entry.version;return 0;
        },
    });
    expect(uploads).toEqual(packageNames);
    expect(result.channel).toBe('beta');expect(result.success).toBe(true);
    expect(Object.values(result.latestBefore)).toEqual(packageNames.map(() => '1.1.1'));
    expect(Object.values(result.distTags).every(t => t.latest === '1.1.1' && t.beta === betaIndex.version)).toBe(true);
    expect(() => checkManifest(betaEntries.at(-1), { ...publicManifest(betaEntries.at(-1)), optionalDependencies: entries.at(-1).manifest.optionalDependencies })).toThrow('optionalDependencies');
});

test('wrong channel receipts and regressed Beta stop before any upload', async () => {
    let uploads = 0;
    const options = { metadata: async () => null, tags: async () => ({ latest: '1.1.1' }), upload: async () => { uploads++; }, save() {} };
    await expect(publishCandidate(betaIndex, betaEntries, { ...options, receipt: {
        version: betaIndex.version, sourceRevision: index.source.revision, channel: 'latest',
    } })).rejects.toThrow('channel differs');
    await expect(publishCandidate(betaIndex, betaEntries, { ...options, tags: async () => ({ latest: '1.2.0' }) })).rejects.toThrow('latest');
    expect(uploads).toBe(0);
});

test('Beta detects actual latest movement and preserves confirmed receipt without automatic repair', async () => {
    const published = new Set();let saved;
    await expect(publishCandidate(betaIndex, betaEntries, {
        metadata: async entry => published.has(entry.name) ? publicManifest(entry) : null,
        tags: async () => published.size === 5 ? { latest: betaIndex.version, beta: betaIndex.version } : { latest: '1.1.1' },
        upload: async entry => { published.add(entry.name);return 0; }, save: state => { saved = structuredClone(state); },
    })).rejects.toThrow('latest changed');
    expect(saved.success).toBe(false);expect(saved.packages.every(p => p.status === 'confirmed')).toBe(true);
    expect(saved.latestBefore.runweft).toBe('1.1.1');
    expect(saved.distTags[packageNames[0]].latest).toBe(betaIndex.version);
});

test('partial Beta resumes the original baseline and accepted packages; latest changes block further uploads', async () => {
    const published = new Set(), uploads = [];let saved;
    const options = {
        metadata: async entry => published.has(entry.name) ? publicManifest(entry) : null,
        tags: async entry => ({ latest: '1.1.1', ...(published.has(entry.name) ? { beta: betaIndex.version } : {}) }),
        upload: async entry => { uploads.push(entry.name);return 0; }, timeoutMs: 0,
        save: state => { saved = structuredClone(state); },
    };
    await expect(publishCandidate(betaIndex, betaEntries, options)).rejects.toThrow('processing pending');
    expect(uploads).toEqual(packageNames.slice(0, 4));
    const receipt = structuredClone(saved);let newUploads = 0;
    await expect(publishCandidate(betaIndex, betaEntries, { ...options, receipt,
        tags: async () => ({ latest: '1.1.2' }), upload: async () => { newUploads++; },
    })).rejects.toThrow('latest changed');expect(newUploads).toBe(0);
    for (const name of uploads) published.add(name);
    const result = await publishCandidate(betaIndex, betaEntries, { ...options, receipt,
        upload: async entry => { expect(entry.name).toBe('runweft');newUploads++;published.add(entry.name);return 0; },
    });
    expect(result.success).toBe(true);expect(result.channel).toBe('beta');expect(newUploads).toBe(1);
});

test('public versions wait for channel tag propagation without reuploading', async () => {
    let updated = false, uploads = 0, pauses = 0;
    const result = await publishCandidate(betaIndex, betaEntries, {
        metadata: async entry => publicManifest(entry),
        tags: async () => ({ latest: '1.1.1', beta: updated ? betaIndex.version : '1.2.0-beta.0' }),
        upload: async () => { uploads++; }, pause: async () => { pauses++;updated = true; }, save() {},
    });
    expect(result.success).toBe(true);expect(uploads).toBe(0);expect(pauses).toBe(1);
});
