import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageNames, publishCandidate, checkManifest, npmPublishArgs } from '../npm-publish.mjs';
import { checkNpmTrust } from '../check-npm-trust.mjs';

const index = { version: '1.2.0', source: { revision: 'a'.repeat(40) } };
const entries = packageNames.map(name => ({ name, version: index.version, sha512: name,
    manifest: { name, version: index.version, repository: { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' } } }));
const publicManifest = entry => ({ ...entry.manifest, dist: { integrity: `sha512-${entry.sha512}` } });
const publish = options => publishCandidate(index, entries, {
    tags: async entry => ({ latest: await options.metadata(entry) ? index.version : '1.1.0' }), ...options,
});


test('a conflicting main version stops before any platform upload', async () => {
    const uploads = [];
    await assert.rejects(publish({ metadata: async entry => entry.name === 'runweft' ?
        { ...publicManifest(entry), dist: { integrity: 'different' } } : null,
    upload: async entry => uploads.push(entry.name), save() {} }), /published version differs/);
    assert.deepEqual(uploads, []);
});

test('accepted platform uploads are confirmed before the main package', async () => {
    const uploads = [], publicPackages = new Set();
    let saved;
    const result = await publish({
        metadata: async entry => publicPackages.has(entry.name) ? publicManifest(entry) : null,
        upload: async entry => {
            assert.equal(saved.packages.find(p => p.name === entry.name).status, 'uploading');
            if (entry.name === 'runweft') assert.equal(publicPackages.size, 4);
            uploads.push(entry.name);
            return 0;
        },
        pause: async () => { for (const name of uploads) publicPackages.add(name); },
        save: state => { saved = structuredClone(state); },
    });
    assert.equal(result.success, true);
    assert.deepEqual(uploads, packageNames);
    assert.equal(result.packages.every(p => p.status === 'confirmed'), true);
});

test('pending processing retains receipts and a retry never reuploads accepted packages', async () => {
    let saved;
    const uploads = [];
    await assert.rejects(publish({ metadata: async () => null,
        upload: async entry => { uploads.push(entry.name); return 0; },
        timeoutMs: 0, save: state => { saved = structuredClone(state); },
    }), /processing pending/);
    assert.deepEqual(uploads, packageNames.slice(0, 4));
    assert.equal(saved.packages.every(p => p.status === 'accepted'), true);
    const resumedUploads = [];
    const result = await publish({ receipt: saved,
        metadata: async entry => entry.name !== 'runweft' || resumedUploads.length ? publicManifest(entry) : null,
        upload: async entry => { resumedUploads.push(entry.name); return 0; }, save() {},
    });
    assert.equal(result.success, true);
    assert.deepEqual(resumedUploads, ['runweft']);
});

test('unknown upload outcome remains blocked until public npm proves its integrity', async () => {
    let saved;
    await assert.rejects(publish({ metadata: async () => null, upload: async () => 1,
        save: state => { saved = structuredClone(state); },
    }), /outcome unknown/);
    assert.equal(saved.packages[0].status, 'uploading');
    let calls = 0;
    await assert.rejects(publish({ receipt: saved, metadata: async () => null,
        upload: async () => { calls++; }, save() {},
    }), /outcome unknown/);
    assert.equal(calls, 0);
    const result = await publish({ receipt: saved, metadata: async entry => publicManifest(entry),
        upload: async () => { calls++; }, save() {},
    });
    assert.equal(result.success, true);
    assert.equal(calls, 0);
});

test('receipt source and metadata dependencies must match the same candidate', async () => {
    await assert.rejects(publish({ receipt: { version: index.version, sourceRevision: 'b'.repeat(40) },
        metadata: async () => null, upload() {}, save() {},
    }), /original candidate/);
    assert.throws(() => checkManifest(entries[0], { ...publicManifest(entries[0]), optionalDependencies: { unexpected: '1' } }), /optionalDependencies differs/);
});

test('OIDC exchanges all five package tokens without retaining any credentials', async () => {
    const requests = [];
    const report = await checkNpmTrust({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/id?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' },
        async (url, options) => {
            requests.push({ url: String(url), options });
            return { ok: true, status: requests.length === 1 ? 200 : 201,
                json: async () => requests.length === 1 ? { value: 'id-secret' } : { token: 'npm-secret' } };
        });
    assert((requests[0].url).includes('audience=npm%3Aregistry.npmjs.org'));
    assert.deepEqual(requests.slice(1).map(r => r.url.split('/').at(-1)), packageNames);
    assert.equal(requests.slice(1).every(r => r.options.method === 'POST' && r.options.headers.Authorization === 'Bearer id-secret'), true);
    assert.equal(report.success, true);
    assert.doesNotMatch(JSON.stringify(report), /request-secret|id-secret|npm-secret/);
});

test('an OIDC rejection reports only the package and status, never a response token', async () => {
    let calls = 0;
    await assert.rejects(checkNpmTrust({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/id', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret' },
        async () => ++calls === 1 ? { ok: true, status: 200, json: async () => ({ value: 'secret' }) } :
            { ok: false, status: 403, json: async () => { throw new Error('Never read rejected response'); } },
    ), /npm OIDC HTTP 403/);
    assert.equal(calls, 2);
});

const config = { userConfig: 'isolated/npmrc', globalConfig: 'isolated/global', cache: 'isolated/cache' };
test('dry-run and upload share explicit beta/latest parameters and isolated configs', () => {
    for (const version of ['1.2.0', '1.2.0-beta.1']) for (const dryRun of [true, false]) {
        const args = npmPublishArgs({ version, tarball: 'candidate.tgz' }, { ...config, dryRun });
        assert((args).includes('--tag=' + (version.includes('-beta.') ? 'beta' : 'latest')));
        assert.equal((args.filter(arg => arg.startsWith('--tag='))).length, 1);
        assert.equal(args.includes('--dry-run'), dryRun);
        assert.equal(args.includes('--force'), dryRun);
        assert((args).includes('--ignore-scripts'));
        assert((args).includes('--userconfig=isolated/npmrc'));
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
            assert((npmPublishArgs(entry, { ...config, dryRun: false })).includes('--tag=beta'));
            if (entry.name === 'runweft') assert.equal(published.size, 4);
            uploads.push(entry.name);published.add(entry.name);tags[entry.name].beta = entry.version;return 0;
        },
    });
    assert.deepEqual(uploads, packageNames);
    assert.equal(result.channel, 'beta');assert.equal(result.success, true);
    assert.deepEqual(Object.values(result.latestBefore), packageNames.map(() => '1.1.1'));
    assert.equal(Object.values(result.distTags).every(t => t.latest === '1.1.1' && t.beta === betaIndex.version), true);
    assert.throws(() => checkManifest(betaEntries.at(-1), { ...publicManifest(betaEntries.at(-1)), optionalDependencies: entries.at(-1).manifest.optionalDependencies }), /optionalDependencies/);
});

test('wrong channel receipts and regressed Beta stop before any upload', async () => {
    let uploads = 0;
    const options = { metadata: async () => null, tags: async () => ({ latest: '1.1.1' }), upload: async () => { uploads++; }, save() {} };
    await assert.rejects(publishCandidate(betaIndex, betaEntries, { ...options, receipt: {
        version: betaIndex.version, sourceRevision: index.source.revision, channel: 'latest',
    } }), /channel differs/);
    await assert.rejects(publishCandidate(betaIndex, betaEntries, { ...options, tags: async () => ({ latest: '1.2.0' }) }), /latest/);
    assert.equal(uploads, 0);
});

test('Beta detects actual latest movement and preserves confirmed receipt without automatic repair', async () => {
    const published = new Set();let saved;
    await assert.rejects(publishCandidate(betaIndex, betaEntries, {
        metadata: async entry => published.has(entry.name) ? publicManifest(entry) : null,
        tags: async () => published.size === 5 ? { latest: betaIndex.version, beta: betaIndex.version } : { latest: '1.1.1' },
        upload: async entry => { published.add(entry.name);return 0; }, save: state => { saved = structuredClone(state); },
    }), /latest changed/);
    assert.equal(saved.success, false);assert.equal(saved.packages.every(p => p.status === 'confirmed'), true);
    assert.equal(saved.latestBefore.runweft, '1.1.1');
    assert.equal(saved.distTags[packageNames[0]].latest, betaIndex.version);
});

test('partial Beta resumes the original baseline and accepted packages; latest changes block further uploads', async () => {
    const published = new Set(), uploads = [];let saved;
    const options = {
        metadata: async entry => published.has(entry.name) ? publicManifest(entry) : null,
        tags: async entry => ({ latest: '1.1.1', ...(published.has(entry.name) ? { beta: betaIndex.version } : {}) }),
        upload: async entry => { uploads.push(entry.name);return 0; }, timeoutMs: 0,
        save: state => { saved = structuredClone(state); },
    };
    await assert.rejects(publishCandidate(betaIndex, betaEntries, options), /processing pending/);
    assert.deepEqual(uploads, packageNames.slice(0, 4));
    const receipt = structuredClone(saved);let newUploads = 0;
    await assert.rejects(publishCandidate(betaIndex, betaEntries, { ...options, receipt,
        tags: async () => ({ latest: '1.1.2' }), upload: async () => { newUploads++; },
    }), /latest changed/);assert.equal(newUploads, 0);
    for (const name of uploads) published.add(name);
    const result = await publishCandidate(betaIndex, betaEntries, { ...options, receipt,
        upload: async entry => { assert.equal(entry.name, 'runweft');newUploads++;published.add(entry.name);return 0; },
    });
    assert.equal(result.success, true);assert.equal(result.channel, 'beta');assert.equal(newUploads, 1);
});

test('public versions wait for channel tag propagation without reuploading', async () => {
    let updated = false, uploads = 0, pauses = 0;
    const result = await publishCandidate(betaIndex, betaEntries, {
        metadata: async entry => publicManifest(entry),
        tags: async () => ({ latest: '1.1.1', beta: updated ? betaIndex.version : '1.2.0-beta.0' }),
        upload: async () => { uploads++; }, pause: async () => { pauses++;updated = true; }, save() {},
    });
    assert.equal(result.success, true);assert.equal(uploads, 0);assert.equal(pauses, 1);
});


test('metadata and channel propagation share one bounded processing budget', async t => {
    let clock = 0, pauses = 0, saved;
    t.mock.method(Date, 'now', () => clock);
    const uploaded = new Set();
    await assert.rejects(publishCandidate(betaIndex, betaEntries, {
        timeoutMs: 10,
        metadata: async entry => uploaded.has(entry.name) && (entry.name === 'runweft' || clock >= 6) ? publicManifest(entry) : null,
        tags: async () => ({ latest: '1.1.1', beta: clock >= 18 ? betaIndex.version : '1.2.0-beta.0' }),
        upload: async entry => { uploaded.add(entry.name); return 0; },
        pause: async () => { clock += 6; pauses++; },
        save: state => { saved = structuredClone(state); },
    }), /dist-tags pending/);
    assert.equal(clock, 12); assert.equal(pauses, 2);
    assert.equal(uploaded.size, 5);
    assert.equal(saved.packages.every(p => p.status === 'confirmed'), true);
    assert.equal(saved.success, false);
});
