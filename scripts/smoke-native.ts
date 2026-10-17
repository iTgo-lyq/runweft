import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { preflightNativeSetup } from './fixtures/native-preflight';
import { preflightBinaries, preflightBrowser } from '../test/preflight';

const binary = resolve(process.argv[2] ?? 'dist/runweft'), selection = process.argv[3] ?? 'all';
const backbone = [
    { id: 'N1', case: 'local-codex-codex', workspace: 'shared' },
    { id: 'N2', case: 'hub-claude-claude', workspace: 'shared' },
    { id: 'N3', case: 'hub-codex-claude', workspace: 'worktree', retry: true },
    { id: 'N4', case: 'local-claude-codex', workspace: 'worktree' },
    { id: 'N5', case: 'hub-codex-claude', workspace: 'remote' },
    { id: 'N6', case: 'hub-claude-codex', workspace: 'remote' },
];
const matrix = selection === 'expanded' ? ['shared', 'worktree', 'remote'].flatMap(workspace => ['codex', 'claude'].flatMap(host => ['codex', 'claude'].map(flavor => ({ id: `E-${workspace}-${host}-${flavor}`, case: `hub-${host}-${flavor}`, workspace, retry: false })))) : backbone;
const full = selection === 'all' || selection === 'expanded';
const probes = ['C-codex', 'C-claude', 'R-codex', 'R-claude'];
assert(selection === 'preflight' || full || matrix.some(item => item.id === selection) || probes.includes(selection), 'Select preflight, all, expanded, N1–N6, C-codex/C-claude or R-codex/R-claude');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/native-backbone-')), evidencePath = join(root, 'evidence.json');
const evidence: any = { kind: 'native-backbone', selection, previous: process.argv[4], startedAt: new Date().toISOString(), phase: 'preflight', cases: [], success: false };
const save = () => writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(`Evidence: ${evidencePath}`); save();
try {
const binaries = preflightBinaries(binary);
await preflightBrowser();
const contract = Bun.spawn([process.execPath, 'test', './test/integration/acceptance-fixtures.test.ts'], { stdio: ['ignore', 'inherit', 'inherit'] });
assert.equal(await contract.exited, 0, 'Producer/consumer fixture contract failed before model work');
await preflightNativeSetup(binary);
const sources = spawnSync('git', ['ls-files', 'scripts/fixtures', 'test', 'scripts/smoke-collaboration.ts', 'scripts/smoke-native.ts', 'scripts/smoke-shared-package.ts', 'scripts/smoke-worktree-package.mjs', 'scripts/smoke-remote-package.ts', 'scripts/smoke-task-controls.ts', 'scripts/smoke-reconstruction.ts'], { encoding: 'utf8' });
assert.equal(sources.status, 0);
const hash = createHash('sha256');
for (const file of sources.stdout.trim().split('\n').sort()) hash.update(file).update(readFileSync(file));
for (const file of [join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'), join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json'), process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')]) if (existsSync(file)) hash.update(file).update(readFileSync(file));
const inputs = { binaries, scripts: hash.digest('hex'), models: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^RUNWEFT_SMOKE_(CODEX|CLAUDE)_(MODEL|EFFORT)$/.test(key))) };
let previous: any;
if (process.argv[4]) {
    const path = resolve(process.argv[4]); assert(path.startsWith(resolve('.dev-smoke') + sep));
    previous = JSON.parse(readFileSync(path, 'utf8')); assert.equal(previous.kind, 'native-backbone');
    assert.deepEqual(previous.inputs, inputs, 'Candidate, helper or model selection changed: prior cases cannot be reused');
}
evidence.inputs = inputs; evidence.phase = 'cases';
evidence.cases = !full ? (previous?.cases.filter((item: any) => item.id !== selection) ?? []) : [];
async function run(item: any, phase: string, script: string, args: string[], env: NodeJS.ProcessEnv) {
    item.phase = phase; const start = Date.now(); save();
    console.log(`${item.id}: ${phase}`);
    const log = join(root, `${item.id}-${phase}.log`); writeFileSync(log, '', { mode: 0o600 });
    const read = async (stream: ReadableStream<Uint8Array>) => { let output = ''; for await (const chunk of stream) { const text = new TextDecoder().decode(chunk); output += text; appendFileSync(log, text); } return output; };
    const child = Bun.spawn([script.endsWith('.mjs') ? 'node' : process.execPath, resolve('scripts', script), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)]);
    const file = [...stdout.matchAll(/^Evidence: (.+\/evidence\.json)$/gm)].at(-1)?.[1];
    item.steps.push({ phase, elapsedMs: Date.now() - start, exitCode: code, log, evidence: file }); save();
    assert.equal(code, 0, `${item.id} ${phase} failed; inspect ${log}. No automatic whole-matrix retry.`);
    assert(file && existsSync(file), 'Successful case must publish its evidence');
    const result = JSON.parse(readFileSync(file, 'utf8')); assert.equal(result.success, true); assert.deepEqual(result.cleanupErrors ?? [], []);
    return { file, result };
}
    for (const id of [...matrix.map(item => item.id), ...probes].filter(id => selection !== 'preflight' && (full || selection === id))) {
        const prior = previous?.cases.find((item: any) => item.id === id && item.success);
        if (prior) {
            for (const step of prior.steps) assert.equal(JSON.parse(readFileSync(step.evidence, 'utf8')).success, true);
            evidence.cases.push({ ...prior, reusedFrom: resolve(process.argv[4]!) }); save(); console.log(`REUSE ${id}`); continue;
        }
        const item: any = { id, startedAt: new Date().toISOString(), phase: 'setup', steps: [], success: false }; evidence.cases.push(item);
        if (process.env.RUNWEFT_SMOKE_FAIL_CASE === id) { item.phase = 'injected-before-producer'; item.injected = true; throw new Error(`Injected case failure: ${id}; no model launched`); }
        const env = { ...process.env };
        for (const key of ['RUNWEFT_SMOKE_CASE', 'RUNWEFT_SMOKE_WORKSPACE', 'RUNWEFT_SMOKE_REMOTE', 'RUNWEFT_SMOKE_CONTROLS', 'RUNWEFT_SMOKE_DISCONNECT', 'RUNWEFT_SMOKE_RETRY_FINISH', 'RUNWEFT_SMOKE_LONG_WAIT']) delete env[key];
        const spec = matrix.find(spec => spec.id === id);
        if (spec) {
            Object.assign(env, { RUNWEFT_SMOKE_CASE: spec.case, RUNWEFT_SMOKE_WORKSPACE: spec.workspace, RUNWEFT_SMOKE_REMOTE: spec.workspace === 'remote' ? '1' : '0', RUNWEFT_SMOKE_RETRY_FINISH: spec.retry ? '1' : '0', RUNWEFT_SMOKE_LONG_WAIT: ['N1', 'N2', 'E-shared-codex-codex', 'E-shared-claude-claude'].includes(id) ? '1' : '0' });
            const produced = await run(item, 'producer', 'smoke-collaboration.ts', [binary], env);
            item.mcpCalls = produced.result.cases.reduce((total: number, value: any) => total + value.calls.length, 0);
            const script = spec.workspace === 'remote' ? 'smoke-remote-package.ts' : spec.workspace === 'worktree' ? 'smoke-worktree-package.mjs' : 'smoke-shared-package.ts';
            await run(item, 'consumer-cleanup', script, spec.workspace === 'remote' ? [binary, binaries.hapi.path, produced.file] : [binary, produced.file], env);
            assert.equal(JSON.parse(readFileSync(produced.file, 'utf8')).consumed, true);
        } else {
            env.RUNWEFT_SMOKE_RUNTIME = id.slice(2);
            await run(item, 'probe-cleanup', id.startsWith('C-') ? 'smoke-task-controls.ts' : 'smoke-reconstruction.ts', [binary, binaries.hapi.path], env);
        }
        item.phase = 'complete'; item.success = true; item.finishedAt = new Date().toISOString(); save(); console.log(`PASS ${id} producer/consumer/cleanup`);
    }
    evidence.success = true;
} catch (error) { evidence.error = String(error); throw error; }
finally { evidence.finishedAt = new Date().toISOString(); save(); }
