import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite, dataPaths, loadConfig } from '../src/config';
import { resourceFixture } from './resources-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
    const h = await resourceFixture(cleanups);
    const home = join(h.home, 'cli-client');
    const cwd = join(h.home, 'project-one'), second = join(h.home, 'project-two');
    mkdirSync(cwd); mkdirSync(second);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    Object.assign(env, { RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: h.url, RUNWEFT_HUB_TOKEN: 'test-alpha' });
    const config = loadConfig(home, env);
    const identity = join(dataPaths(config).hapiClient, 'settings.json');
    const cliPath = resolve('src/cli.ts');
    async function cli(args: string[], options: { human?: boolean; cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
        const child = Bun.spawn([process.execPath, cliPath, '--home', home, ...(options.human ? [] : ['--json']), ...args], {
            env: { ...env, ...options.env }, cwd: options.cwd ?? cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
        });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout + stderr).not.toContain('test-alpha');
        return { stdout, stderr, code, value: !options.human && stdout ? JSON.parse(stdout) : undefined,
            error: !options.human && stderr ? JSON.parse(stderr).error : undefined };
    }
    return { ...h, home, config, identity, cli, cwd, second };
}

test('resource CLI has actionable empty and invalid-input output, never starting services', async () => {
    const h = await fixture();
    const missing = await h.cli(['machine', 'register']);
    expect(missing.code).toBe(1);
    expect(missing.error).toMatchObject({ code: 'local_machine_missing', hint: expect.stringContaining('runweft start') });
    expect(existsSync(h.identity)).toBe(false);
    expect(h.calls).toHaveLength(0);
    const machines = await h.cli(['machine', 'list'], { human: true });
    expect(machines.code).toBe(0);
    expect(machines.stdout).toContain('runweft machine register');
    const runtimes = await h.cli(['runtime', 'list'], { human: true });
    expect(runtimes.stdout).toContain('runweft runtime register codex');
    expect((await h.cli(['runtime', 'register', 'gemini'])).error.code).toBe('invalid_resource_request');
    expect((await h.cli(['machine', 'register', '--name', '  '])).error.code).toBe('invalid_resource_request');
    expect((await h.cli(['runtime', 'register', 'codex', '--name', 'x'.repeat(65)])).error.hint).toContain('64');
    expect(existsSync(join(h.cwd, '.runweft'))).toBe(false);
    expect(existsSync(dataPaths(h.config).state)).toBe(false);
});

test('resource CLI manages stable global identities across cwd and keeps JSON and human facts consistent', async () => {
    const h = await fixture();
    atomicWrite(h.identity, JSON.stringify({ machineId: 'own' }));
    const discovery = await h.cli(['runtime', 'discover']);
    expect(discovery.code).toBe(0);
    expect(discovery.value.machine.registered).toBe(false);
    expect(discovery.value.tools.map((tool: any) => tool.flavor)).toEqual(['codex', 'claude']);
    expect((await h.cli(['runtime', 'list'])).value.runtimes).toEqual([]);
    expect((await h.cli(['runtime', 'register', 'codex'])).error.code).toBe('machine_unregistered');
    const registered = await h.cli(['machine', 'register', '--name', 'Dev machine']);
    expect(registered.value.machine).toMatchObject({ id: 'own', name: 'Dev machine', registered: true });
    expect(registered.value.connection).toMatchObject({ mode: 'hub', url: h.url, localMachineId: 'own' });
    expect((await h.cli(['machine', 'show'])).value.machine.name).toBe('Dev machine');
    const first = (await h.cli(['runtime', 'register', 'codex', '--name', 'Reviewer'])).value.runtime;
    const second = (await h.cli(['runtime', 'register', 'codex'], { cwd: h.second })).value.runtime;
    expect(second.id).toBe(first.id); expect(second.name).toBe('Reviewer');
    const claude = (await h.cli(['runtime', 'register', 'claude'])).value.runtime;
    expect(claude.id).not.toBe(first.id);
    expect((await h.cli(['runtime', 'show', first.id], { human: true })).stdout).toContain('模型认证与任务执行：未检查');
    expect((await h.cli(['runtime', 'check', first.id])).code).toBe(0);
    const rename = await h.cli(['runtime', 'rename', first.id, 'Writer']);
    expect(rename.value.runtime).toMatchObject({ id: first.id, name: 'Writer', machineId: 'own' });
    expect((await h.cli(['machine', 'rename', 'own', 'Laptop'])).value.machine.name).toBe('Laptop');
    expect((await h.cli(['machine', 'list'])).value.machines).toHaveLength(1);
    expect((await h.cli(['machine', 'list', '--all'])).value.machines).toHaveLength(3);
    const cancelled = await h.cli(['machine', 'unregister', 'own']);
    expect(cancelled.value.affectedRuntimeIds.sort()).toEqual([first.id, claude.id].sort());
    const blocked = await h.cli(['runtime', 'check', first.id]);
    expect(blocked.code).toBe(1);
    expect(blocked.value.runtime.eligibility.reason.code).toBe('machine_unregistered');
    expect(blocked.value.runtime.registered).toBe(true);
    const blockedHuman = await h.cli(['runtime', 'check', first.id], { human: true });
    expect(blockedHuman.code).toBe(1); expect(blockedHuman.stdout).toContain('恢复登记');
    await h.cli(['machine', 'register']);
    expect((await h.cli(['runtime', 'check', first.id])).code).toBe(0);
    const remove = await h.cli(['runtime', 'unregister', first.id], { human: true });
    expect(remove.stdout).toContain('已有任务继续使用原目标');
    expect((await h.cli(['runtime', 'list'])).value.runtimes).toHaveLength(1);
    expect((await h.cli(['runtime', 'list', '--all'])).value.runtimes).toHaveLength(2);
    expect((await h.cli(['runtime', 'register', 'codex'])).value.runtime).toMatchObject({ id: first.id, name: 'Writer' });
    expect((await h.cli(['runtime', 'show', 'unknown'])).error.code).toBe('runtime_unknown');
    const paths = await h.cli(['paths'], { human: true });
    expect(paths.stdout).toContain('权威资源库位于所连中心');
    expect((await h.cli(['paths'])).value.state).toBe(dataPaths(h.config).state);
    expect(existsSync(join(h.cwd, '.runweft'))).toBe(false);
    expect(existsSync(join(h.second, '.runweft'))).toBe(false);
    expect(existsSync(dataPaths(h.config).state)).toBe(false);
}, 20_000);

test('resource CLI shows history, version failure and per-target problems without a false execution claim', async () => {
    const h = await fixture();
    atomicWrite(h.identity, JSON.stringify({ machineId: 'own' }));
    const runtime = await h.register();
    const own = h.machines.find(machine => machine.id === 'own')!;
    own.active = false;
    const offline = await h.cli(['runtime', 'show', runtime.id]);
    expect(offline.code).toBe(0);
    expect(offline.value.runtime.inspectionCurrent).toBe(false);
    const human = await h.cli(['runtime', 'check', runtime.id], { human: true });
    expect(human.code).toBe(1);
    expect(human.stdout).toContain('历史观察');
    expect(human.stdout).toContain('目标机器离线');
    own.active = true;
    const native = h.inspections.get('own')![0];
    native.details.version = null; native.details.versionStatus = 'timeout';
    const unknownVersion = await h.cli(['runtime', 'check', runtime.id], { human: true });
    expect(unknownVersion.code).toBe(0);
    expect(unknownVersion.stdout).toContain('版本：查询超时');
    native.details.executable = null; native.details.versionStatus = 'not_found';
    const missing = await h.cli(['runtime', 'check', runtime.id]);
    expect(missing.code).toBe(1);
    expect(missing.value.runtime.eligibility.reason).toMatchObject({ code: 'runtime_command_missing', hint: expect.stringContaining('runweft restart') });
    const discover = await h.cli(['runtime', 'discover']);
    expect(discover.code).toBe(0);
    expect(discover.value.tools.find((tool: any) => tool.flavor === 'codex').toolFound).toBe(false);
});
