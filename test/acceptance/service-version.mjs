import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Exercise compiled diagnosis against a live service whose HTTP health advertises a different version.
// This is a protocol mismatch probe, never an old database or binary upgrade.
export async function verifyServiceVersionDiagnosis(binary, root, env, serviceState, actualUrl) {
    const home = join(root, 'version-probe');
    function local(args) {
        const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
    }
    local(['init']); const paths = local(['paths']);
    const server = createServer((request, response) => { void (async () => {
        const upstream = await fetch(actualUrl + request.url, { signal: AbortSignal.timeout(3000) });
        const body = await upstream.json();
        if (request.url === '/api/runweft/health') body.version = '0.0.0-smoke-mismatch';
        response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
    })().catch(() => { response.writeHead(502); response.end('{}'); }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        mkdirSync(dirname(paths.process), { recursive: true });
        writeFileSync(paths.process, JSON.stringify({ ...serviceState, url }));
        async function command(args, expected) {
            const child = spawn(binary, ['--home', home, '--json', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
            const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
            assert.equal(code, expected, stderr); return JSON.parse(stdout || stderr);
        }
        const status = await command(['status'], 0);
        assert.equal(status.service.running, true); assert.equal(status.version, '0.0.0-smoke-mismatch');
        assert.notEqual(status.installedVersion, status.version); assert.equal(status.restartRequired, true);
        const doctor = await command(['doctor'], 1);
        assert.equal(doctor.ok, false); assert.equal(doctor.checks.find(check => check.name === 'hosted_service').ok, false);
        return { version: status.version, installedVersion: status.installedVersion, restartRequired: true, doctorRejects: true };
    } finally {
        rmSync(paths.process, { force: true });
        server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}
