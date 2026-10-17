import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fixture } from '../helpers';
import { fixtureCleanup } from '../fixture-cleanup';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { appendFixtureRound } from './fixture-round';
import { watchNativeHost } from '../../scripts/fixtures/native-host';
import { installedBinaries, assertCandidateBinaries } from '../../scripts/fixtures/installed-binaries.mjs';
import { assertCollaborationRecords } from '../../scripts/fixtures/collaboration-package.mjs';
import { preflightBrowser } from '../preflight';

const cleanup = fixtureCleanup([]);
afterEach(() => cleanup.close());

test('current fixture writes two scoped rounds without native dispatch; missing snapshots and cross-round inputs still fail', async () => {
    const h = await hubDelegationFixture(cleanup.resources);
    const kick = spyOn(h.gateway.delegation.coordinator, 'kick').mockImplementation(() => {});
    const accepted = await h.post('spawn', h.payload());
    await h.gateway.delegation.close(); kick.mockRestore();
    const store = h.gateway.delegation.coordinator.store;
    const bundle = store.require(h.namespace, accepted.agent_id), first = bundle.rounds[0];
    Object.assign(first, { phase: 'finished', stop: 'not_started', executionAbsent: true, finish: 'complete' });
    store.save(bundle.task, first, bundle.inputs);
    const next = appendFixtureRound(store, bundle.task, first.agent, { stop: 'not_started', executionAbsent: true, report: 'SECOND' });
    const current = store.require(h.namespace, bundle.task.id);
    expect(current.rounds).toHaveLength(2); expect(current.rounds[1].agent).toEqual(first.agent);
    expect(current.inputs.filter(input => input.roundId === next.round.id)).toHaveLength(1);
    expect(() => store.save(next.task, next.round, current.inputs)).toThrow();
    expect(() => appendFixtureRound(store, next.task, undefined as any, { stop: 'not_started' })).toThrow();
    // Explicit stored-round fixture, not evidence of a native execution. Read the public DTO through the real route.
    for (const round of current.rounds) { round.stop = 'stopped'; round.sessionId = 'fixture-session'; round.nativeSessionId = 'fixture-native'; store.save(current.task, round, current.inputs.filter(input => input.roundId === round.id)); }
    const rounds = await Promise.all(current.rounds.map(async round => ({ roundId: round.id, view: await h.post('read', { id: accepted.agent_id, roundId: round.id }) })));
    const records = { serverPaths: { state: h.statePath }, ownerId: current.task.hub!.ownerId, spaceId: current.task.hub!.spaceId,
        cases: [{ taskId: current.task.id, targetMachineId: current.task.target.machineId, rounds }] };
    assertCollaborationRecords(JSON.parse(JSON.stringify(records)));
    expect(() => assertCollaborationRecords({ ...records, ownerId: 'foreign-owner' })).toThrow();
    expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0);
});

test('preflight resolves installed launcher/core consistently and rejects bad hash and browser before model work', async () => {
    const root = fixture('candidate-contract', cleanup.resources), packageRoot = join(root, 'node_modules/runweft');
    const native = join(packageRoot, `node_modules/runweft-${process.platform}-${process.arch}`);
    mkdirSync(join(native, 'bin'), { recursive: true });
    writeFileSync(join(native, 'package.json'), '{}');
    const core = join(native, 'bin/runweft'), launcher = join(packageRoot, 'runweft.cjs');
    writeFileSync(core, 'CORE'); writeFileSync(join(native, 'bin/hapi'), 'HAPI'); writeFileSync(launcher, 'LAUNCHER');
    const command = join(root, 'runweft'); symlinkSync(launcher, command);
    const produced = installedBinaries(command);
    expect(assertCandidateBinaries(command, JSON.parse(JSON.stringify(produced)))).toEqual(installedBinaries(core));
    expect(() => assertCandidateBinaries(command, { ...produced, runweft: { path: launcher, sha256: 'wrong-launcher-hash' } })).toThrow('Candidate runweft hash differs');
    await expect(preflightBrowser(join(root, 'missing-chromium'))).rejects.toThrow();
});

test('native host timeout fails even when SIGTERM exits zero; diagnostics never retain raw stderr', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0));console.log('READY');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); });
    const watcher = watchNativeHost(child, 30, 1000);
    try {
        child.stderr!.emit('data', Buffer.from('PRIVATE_SECRET prompt source serverOverloaded'));
        watcher.progress('wait');
        const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
        expect(code).toBe(0); expect(() => watcher.check(code)).toThrow('host_timeout');
        expect(watcher.state.errors).toEqual(['serverOverloaded']);
        expect(JSON.stringify(watcher.state)).not.toContain('PRIVATE_SECRET');
    } finally { watcher.close(); if (child.exitCode === null) child.kill('SIGKILL'); }
});

// Exercise the actual child entrypoints: a failed handoff must still return machine-readable evidence.
test('native consumers publish their failure evidence before any model or source environment starts', () => {
    const root = fixture('consumer-receipt', cleanup.resources), missing = join(root, 'absent-evidence.json');
    for (const [script, args] of [
        ['smoke-shared-package.ts', ['absent-cli', missing]],
        ['smoke-worktree-package.mjs', ['absent-cli', missing]],
        ['smoke-remote-package.ts', ['absent-cli', 'absent-hapi', missing]],
    ] as const) {
        const result = spawnSync(script.endsWith('.mjs') ? 'node' : process.execPath, [resolve('scripts', script), ...args], { encoding: 'utf8', timeout: 10_000 });
        const evidence = result.stdout.split('\n').find(line => line.startsWith('Evidence: '))?.slice('Evidence: '.length);
        expect(evidence).toBeDefined();
        if (evidence) {
            expect(dirname(evidence).startsWith(resolve('.dev-smoke') + '/')).toBe(true);
            cleanup.resources.push(() => rmSync(dirname(evidence), { recursive: true, force: true }));
            const record = JSON.parse(readFileSync(evidence, 'utf8'));
            expect(record.success).toBe(false); expect(record.cleanupErrors).toEqual([]);
            expect(record.error.length).toBeGreaterThan(0); // Missing input or a rejected foreign fixture path.
        }
        expect(result.status).toBe(1);
    }
});
