import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageNames, registry } from './npm-publish.mjs';

// This is the npm Registry API's documented token exchange; no package is uploaded.
export async function checkNpmTrust(env, request = fetch, report = { packages: [], success: false }) {
    assert(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'Run this check in GitHub Actions with id-token: write');
    const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    url.searchParams.set('audience', 'npm:registry.npmjs.org');
    const idResponse = await request(url, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    assert(idResponse.ok, `GitHub OIDC request HTTP ${idResponse.status}`);
    const { value: idToken } = await idResponse.json();
    assert(typeof idToken === 'string' && idToken.length, 'GitHub OIDC response missing token');
    for (const name of packageNames) {
        const response = await request(`${registry}-/npm/v1/oidc/token/exchange/package/${name}`, {
            method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, signal: AbortSignal.timeout(30_000) });
        report.packages.push({ name, status: response.status, authorized: false });
        assert(response.ok, `${name}: npm OIDC HTTP ${response.status}; check repository, workflow and package trust settings`);
        const body = await response.json();
        assert(typeof body.token === 'string' && body.token.length, `${name}: npm OIDC response missing token`);
        report.packages.at(-1).authorized = true;
    }
    report.success = true;
    return report;
}

async function main() {
    const root = resolve('.dev-smoke/npm-publish');
    mkdirSync(root, { recursive: true });
    const report = { packages: [], success: false };
    try {
        await checkNpmTrust(process.env, fetch, report);
        console.log('Five npm packages: OIDC exchange authorized; no upload performed');
    } finally {
        writeFileSync(join(root, 'oidc.json'), JSON.stringify(report, null, 2));
    }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
