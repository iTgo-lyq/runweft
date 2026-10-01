import { expect, test } from 'bun:test';
import { packageNames, isRelease, publishCandidate, checkManifest } from '../scripts/npm-publish.mjs';
import { checkNpmTrust } from '../scripts/check-npm-trust.mjs';

const index = { version: '1.2.0', source: { revision: 'a'.repeat(40) } };
const entries = packageNames.map(name => ({ name, version: index.version, sha512: name,
    manifest: { name, version: index.version, repository: { type: 'git', url: 'git+https://github.com/iTgo-lyq/runweft.git' } } }));
const publicManifest = entry => ({ ...entry.manifest, dist: { integrity: `sha512-${entry.sha512}` } });

test('only a push of the matching stable version tag can publish', () => {
    const tag = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.0' };
    expect(isRelease(tag, index.version)).toBe(true);
    expect(isRelease({ ...tag, GITHUB_EVENT_NAME: 'workflow_dispatch' }, index.version)).toBe(false);
    expect(isRelease({ ...tag, GITHUB_REF_TYPE: 'branch' }, index.version)).toBe(false);
    expect(isRelease({}, index.version)).toBe(false);
    expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'v1.2.1' }, index.version)).toThrow('match package');
    expect(() => isRelease({ ...tag, GITHUB_REF_NAME: 'v1.2.0-beta' }, index.version)).toThrow('stable version');
});

test('a conflicting main version stops before any platform upload', async () => {
    const uploads = [];
    await expect(publishCandidate(index, entries, { metadata: async entry => entry.name === 'runweft' ?
        { ...publicManifest(entry), dist: { integrity: 'different' } } : null,
    upload: async entry => uploads.push(entry.name), save() {} })).rejects.toThrow('published version differs');
    expect(uploads).toEqual([]);
});

test('accepted platform uploads are confirmed before the main package', async () => {
    const uploads = [], publicPackages = new Set();
    let saved;
    const result = await publishCandidate(index, entries, {
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
    await expect(publishCandidate(index, entries, { metadata: async () => null,
        upload: async entry => { uploads.push(entry.name); return 0; },
        timeoutMs: 0, save: state => { saved = structuredClone(state); },
    })).rejects.toThrow('processing pending');
    expect(uploads).toEqual(packageNames.slice(0, 4));
    expect(saved.packages.every(p => p.status === 'accepted')).toBe(true);
    const resumedUploads = [];
    const result = await publishCandidate(index, entries, { receipt: saved,
        metadata: async entry => entry.name !== 'runweft' || resumedUploads.length ? publicManifest(entry) : null,
        upload: async entry => { resumedUploads.push(entry.name); return 0; }, save() {},
    });
    expect(result.success).toBe(true);
    expect(resumedUploads).toEqual(['runweft']);
});

test('unknown upload outcome remains blocked until public npm proves its integrity', async () => {
    let saved;
    await expect(publishCandidate(index, entries, { metadata: async () => null, upload: async () => 1,
        save: state => { saved = structuredClone(state); },
    })).rejects.toThrow('outcome unknown');
    expect(saved.packages[0].status).toBe('uploading');
    let calls = 0;
    await expect(publishCandidate(index, entries, { receipt: saved, metadata: async () => null,
        upload: async () => { calls++; }, save() {},
    })).rejects.toThrow('outcome unknown');
    expect(calls).toBe(0);
    const result = await publishCandidate(index, entries, { receipt: saved, metadata: async entry => publicManifest(entry),
        upload: async () => { calls++; }, save() {},
    });
    expect(result.success).toBe(true);
    expect(calls).toBe(0);
});

test('receipt source and metadata dependencies must match the same candidate', async () => {
    await expect(publishCandidate(index, entries, { receipt: { version: index.version, sourceRevision: 'b'.repeat(40) },
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
