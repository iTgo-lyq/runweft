import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Read completed real model results with an installed package; never dispatch new model work.
const executable = resolve(process.argv[2]), source = JSON.parse(readFileSync(process.argv[3], 'utf8'));
assert(source.success && source.cases.length > 0, 'Requires completed dedicated artifact MCP evidence');
const root = mkdtempSync(resolve('.dev-smoke/artifact-package-'));
const evidence = { executable, fixture: resolve(process.argv[3]), checks: [], success: false, cleanupErrors: [] };
const started = [], env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key === 'HAPI_SESSION_ID') delete env[key];
function cli(home, args, cwd = root) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error}`);
    return JSON.parse(result.stdout);
}
try {
    for (const mode of ['local', 'hub']) {
        if (mode === 'hub' && !source.cases.some(item => item.mode === mode)) continue;
        const home = join(source.root, mode); cli(home, ['start']); started.push(home);
    }
    for (const item of source.cases) {
        const home = join(source.root, item.mode);
        for (const [index, original] of [item.first, item.second].entries()) {
            const current = cli(home, ['task', 'show', original.agent_id, '--round', original.round_id], item.cwd);
            assert.equal(current.status, 'completed'); assert.equal(current.completed_revision, original.completed_revision);
            assert.equal(current.session_id, original.session_id); assert.equal(current.native_session_id, original.native_session_id);
            assert.equal(current.report.text, original.report.text); assert.deepEqual(current.artifacts.manifest, original.artifacts.manifest);
            const file = current.artifacts.manifest.items.find(file => file.name === '成果.txt');
            assert.equal(cli(home, ['artifact', 'show', file.artifactId]).sha256, file.sha256);
            const path = join(root, `${item.id}-${index}.txt`);
            cli(home, ['artifact', 'download', file.artifactId, '--output', path]);
            const bytes = readFileSync(path); assert.equal(bytes.toString(), item.markers[index]);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
            if (item.workspaceMode === 'worktree') assert(existsSync(original.cwd));
        }
        evidence.checks.push(`${item.id}: retained reports, native identities and both output hashes survive installed service restart`);
    }
    evidence.success = true;
} finally {
    for (const home of started.reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Installed artifact evidence: ${join(root, 'evidence.json')}`);
}
