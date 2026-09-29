import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, loadConfig } from '../src/config';
import { applyConfigChanges, checkMcp, clientFiles, configureMcp, listMcpBackups, restoreMcp } from '../src/mcp/install';
import { fixture } from './helpers';
import { replaceCodexMcp } from '../src/mcp/toml';

function setup() {
    const root = fixture('mcp-install');
    const c = loadConfig(join(root, 'runweft'), { ...process.env, HOME: join(root, 'user'), CODEX_HOME: join(root, 'codex'),
        CLAUDE_CONFIG_DIR: undefined, RUNWEFT_MODE: 'local' });
    return { root, c };
}
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const matcher = 'mcp__runweft__.*';

test.skipIf(!Bun.which('codex'))('native Codex editing and Claude merging are idempotent and preserve unrelated settings', async () => {
    const { c } = setup();
    const [codex] = clientFiles(c, 'codex'), [claude, settings] = clientFiles(c, 'claude');
    atomicWrite(codex, '# model comment\nmodel="unmodified" # inline model comment\n\n[mcp_servers.keep]\n# keep server comment\ncommand="unchanged"\n');
    atomicWrite(claude, JSON.stringify({ mcpServers: { keep: { command: 'unchanged' } }, unrelated: { value: 1 } }));
    const beforeHooks = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook' }] },
        { matcher, hooks: [{ type: 'command', command: 'other-runweft-observer' }] }];
    atomicWrite(settings, JSON.stringify({ model: 'unchanged', permissions: { allow: ['Read'] }, hooks: { PreToolUse: beforeHooks } }));
    const first = configureMcp(c, true, 'all');
    expect(first.changed).toBe(true);
    expect(first.files).toHaveLength(3);
    expect(clientFiles(c, 'claude')).toEqual([join(c.env.HOME!, '.claude.json'), join(c.env.HOME!, '.claude', 'settings.json')]);
    expect(statSync(first.backupPath!).mode & 0o777).toBe(0o600);
    const native = Bun.TOML.parse(readFileSync(codex, 'utf8')) as any;
    expect(native.model).toBe('unmodified'); expect(native.mcp_servers.keep.command).toBe('unchanged');
    expect(native.mcp_servers.runweft.tool_timeout_sec).toBe(600);
    expect(readFileSync(codex, 'utf8')).toContain('# inline model comment');
    expect(readFileSync(codex, 'utf8')).toContain('# keep server comment');
    expect(json(claude).unrelated).toEqual({ value: 1 });
    expect(json(settings)).toMatchObject({ model: 'unchanged', permissions: { allow: ['Read'] } });
    expect(json(settings).hooks.PreToolUse.slice(0, 2)).toEqual(beforeHooks);
    expect(configureMcp(c, true, 'all').changed).toBe(false);
    expect(listMcpBackups(c)).toHaveLength(1);
    const check = await checkMcp(c, 'all');
    expect(check.configurationOk).toBe(true);
    expect(check.checks.every(item => item.ok && item.handshake && item.nativeCallVerified === false)).toBe(true);
    const removed = configureMcp(c, false, 'all');
    expect(removed.changed).toBe(true);
    expect((Bun.TOML.parse(readFileSync(codex, 'utf8')) as any).mcp_servers.runweft).toBeUndefined();
    expect(json(claude).mcpServers).toEqual({ keep: { command: 'unchanged' } });
    expect(json(settings).hooks.PreToolUse).toEqual(beforeHooks);
    expect(configureMcp(c, false, 'all').changed).toBe(false);
});

test.skipIf(!Bun.which('codex'))('old managed Codex entries require an explicit upgrade for long waits', async () => {
    const { c } = setup();
    configureMcp(c, true, 'codex');
    const [path] = clientFiles(c, 'codex');
    const old = readFileSync(path, 'utf8').replace('tool_timeout_sec = 600\n', '');
    atomicWrite(path, old);
    expect((await checkMcp(c, 'codex')).checks[0]).toMatchObject({ ok: false, error: { code: 'mcp_timeout_outdated' } });
    expect(readFileSync(path, 'utf8')).toBe(old);
    expect(configureMcp(c, true, 'codex').changed).toBe(true);
    expect((Bun.TOML.parse(readFileSync(path, 'utf8')) as any).mcp_servers.runweft.tool_timeout_sec).toBe(600);
    expect(configureMcp(c, true, 'codex').changed).toBe(false);
});

test('Claude config override, managed update and foreign entry conflicts do not overwrite other data', () => {
    const { root, c } = setup(); c.env.CLAUDE_CONFIG_DIR = join(root, 'claude-custom');
    const [claude, settings] = clientFiles(c, 'claude');
    expect(claude).toBe(join(root, 'claude-custom', '.claude.json'));
    configureMcp(c, true, 'claude', ['/old location/runweft']);
    expect(configureMcp(c, true, 'claude', ['/new location/runweft']).changed).toBe(true);
    expect(json(claude).mcpServers.runweft.command).toBe('/new location/runweft');
    expect(json(settings).hooks.PreToolUse[0].hooks[0].command).toBe('/new location/runweft');
    atomicWrite(claude, JSON.stringify({ mcpServers: { runweft: { command: 'someone-else' } } }));
    expect(() => configureMcp(c, true, 'claude')).toThrow('非 Runweft');
    expect(existsSync(clientFiles(c, 'codex')[0])).toBe(false);
    configureMcp(c, false, 'claude');
    expect(json(claude).mcpServers.runweft.command).toBe('someone-else');
    expect(json(settings).hooks).toBeUndefined();
});

test('two-file write failure restores earlier writes while protecting concurrent edits', () => {
    for (const concurrent of [false, true]) {
        const { root, c } = setup(); const a = join(root, 'a.json'), b = join(root, 'b.json');
        atomicWrite(a, 'before-a'); atomicWrite(b, 'before-b');
        const changes = [{ path: a, before: 'before-a', after: 'after-a' }, { path: b, before: 'before-b', after: 'after-b' }];
        expect(() => applyConfigChanges(c, 'test-failure', changes, (path, content) => {
            if (path === b) { if (concurrent) writeFileSync(a, 'user-edited'); throw new Error('injected disk failure'); }
            atomicWrite(path, content!);
        })).toThrow('配置写入失败');
        expect(readFileSync(a, 'utf8')).toBe(concurrent ? 'user-edited' : 'before-a');
        expect(readFileSync(b, 'utf8')).toBe('before-b');
        expect(listMcpBackups(c)).toHaveLength(1);
    }
});

test('restore is explicit, backed up, and refuses subsequent user changes', () => {
    const { c } = setup(); const [claude, settings] = clientFiles(c, 'claude');
    const installed = configureMcp(c, true, 'claude');
    const restored = restoreMcp(c, installed.backupId!);
    expect(existsSync(claude)).toBe(false); expect(existsSync(settings)).toBe(false);
    restoreMcp(c, restored.backupId!);
    expect(json(claude).mcpServers.runweft).toBeDefined();
    atomicWrite(settings, JSON.stringify({ ...json(settings), extraUserSetting: 'preserve' }));
    expect(() => restoreMcp(c, installed.backupId!)).toThrow('其他进程修改');
    expect(json(claude).mcpServers.runweft).toBeDefined();
    expect(json(settings).extraUserSetting).toBe('preserve');
    expect(() => restoreMcp(c, '../../elsewhere')).toThrow('备份 ID');
});

test('check diagnoses disabled registration, mismatched hook home, and an invalid binary path', async () => {
    const { c } = setup();
    configureMcp(c, true, 'claude');
    const [claude, settings] = clientFiles(c, 'claude');
    const initial = json(settings); initial.hooks.PreToolUse[0].hooks[0].command = '/outdated/runweft'; atomicWrite(settings, JSON.stringify(initial));
    expect((await checkMcp(c, 'claude')).checks[0]).toMatchObject({ ok: false, error: { code: 'claude_hook_mismatch' } });
    configureMcp(c, true, 'claude', ['/no/such/runweft']);
    expect((await checkMcp(c, 'claude')).checks[0].ok).toBe(false);
    const config = json(claude); config.mcpServers.runweft.enabled = false; atomicWrite(claude, JSON.stringify(config));
    expect((await checkMcp(c, 'claude')).checks[0]).toMatchObject({ error: { code: 'mcp_disabled' } });
    const other = loadConfig(join(c.home, 'other'), c.env);
    configureMcp(other, true, 'claude');
    expect((await checkMcp(c, 'claude')).checks[0]).toMatchObject({ error: { code: 'mcp_home_mismatch' } });
});

test('TOML edits target semantic keys across tables, dotted keys and inline tables without touching strings or comments', () => {
    const generated = '[mcp_servers.runweft]\ncommand="new"\nargs=["--home", "/space path"]\n[mcp_servers.runweft.env]\nRUNWEFT_MCP_MANAGED="1"\n';
    const forms = [
        '[mcp_servers."runweft"]\ncommand="old"\n[mcp_servers.runweft.env]\nOLD="yes"\n[mcp_servers.keep]\ncommand="keep" # untouched\n',
        '[mcp_servers]\nrunweft.command="old"\nkeep.command="keep" # untouched\nrunweft.args=[]\n',
        'mcp_servers = { keep={command="keep"}, runweft={command="old"} } # untouched\n',
        'mcp_servers = { runweft.command="old", keep.command="keep", runweft.args=[], runweft.env.OLD="yes" } # untouched\n',
        'mcp_servers = { runweft.command="old", runweft.args=[] } # untouched\n',
        'mcp_servers = { keep={command="keep"} } # untouched\n',
    ];
    for (const form of forms) {
        const original = 'note="""\n[mcp_servers.runweft]\nThis is a string, not a table.\n"""\n' + form;
        const updated = replaceCodexMcp(original, generated, true);
        const value = Bun.TOML.parse(updated) as any;
        expect(value.mcp_servers.runweft).toEqual((Bun.TOML.parse(generated) as any).mcp_servers.runweft);
        expect(value.note).toBe((Bun.TOML.parse(original) as any).note);
        expect(updated).toContain('# untouched');
        const removed = replaceCodexMcp(updated, '', false);
        const result = Bun.TOML.parse(removed) as any;
        expect(result.mcp_servers?.runweft).toBeUndefined();
        expect(result.mcp_servers?.keep).toEqual((Bun.TOML.parse(original) as any).mcp_servers?.keep);
        expect(removed).toContain('# untouched');
    }
});
