import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resetData } from '../src/reset';
import { atomicWrite } from '../src/config';
import { fixture } from './helpers';

function sample() {
    const root = fixture('reset'), home = join(root, 'data'), outside = join(root, 'project');
    mkdirSync(outside); writeFileSync(join(outside, 'keep.txt'), 'source');
    const files = ['config.yaml', 'agents/old.yaml', 'server/runweft/state.sqlite', 'server/hapi/settings.json', 'server/hapi/hapi.db',
        'server/hapi/artifacts/old-file', 'client.sqlite', 'connections/local/identity.json', 'connections/local/machine.json', 'connections/local/hapi/settings.json'];
    for (const file of files) atomicWrite(join(home, file), 'old test history');
    const retained = ['connections/local/hapi/workspaces/environments/old/checkout/keep.txt', 'connections/local/hapi/workspaces/repositories/cache/object',
        'connections/local/hapi/artifact-transfers/output', 'backups/mcp/native/config.toml'];
    for (const file of retained) atomicWrite(join(home, file), 'keep');
    return { home, outside, files, retained };
}
test('prerelease reset previews then clears fixed product records while retaining worktrees, Git objects, output candidates and native backups', () => {
    const h = sample(), preview = resetData(h.home);
    expect(preview.applied).toBe(false);
    for (const file of h.files) expect(existsSync(join(h.home, file))).toBe(true);
    expect(resetData(h.home, true).applied).toBe(true);
    for (const file of h.files) expect(existsSync(join(h.home, file))).toBe(false);
    for (const file of h.retained) expect(readFileSync(join(h.home, file), 'utf8')).toBe('keep');
    expect(readFileSync(join(h.outside, 'keep.txt'), 'utf8')).toBe('source');
    expect(resetData(h.home, true).applied).toBe(true);
});
test('all running process and symlink checks complete before any destructive reset', () => {
    for (const processPath of ['server/process.json', 'connections/local/hapi/runner.state.json']) {
        const h = sample(); atomicWrite(join(h.home, processPath), JSON.stringify({ pid: process.pid }));
        expect(resetData(h.home).applied).toBe(false);
        expect(() => resetData(h.home, true)).toThrow('仍在运行');
        for (const file of h.files) expect(existsSync(join(h.home, file))).toBe(true);
    }
    const h = sample(); symlinkSync(h.outside, join(h.home, 'connections', 'outside'));
    expect(() => resetData(h.home, true)).toThrow('符号链接');
    expect(existsSync(join(h.home, 'config.yaml'))).toBe(true);
    expect(readFileSync(join(h.outside, 'keep.txt'), 'utf8')).toBe('source');
});
test('CLI reset works with incompatible old config and prints only path/impact metadata', async () => {
    const h = sample();
    const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), '--home', h.home, '--json', 'data', 'reset', '--apply'], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0); expect(stderr).toBe(''); expect(stdout).not.toContain('old test history');
    expect(JSON.parse(stdout).applied).toBe(true); expect(existsSync(join(h.home, 'config.yaml'))).toBe(false);
});
