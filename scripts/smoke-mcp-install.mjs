import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';

// Uses an installed CLI and the real Codex config editor, without model calls or user files.
export function verifyMcpInstallation(cli, root, inheritedEnv) {
    const home = join(root, 'runweft');
    const codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
    for (const path of [codexHome, claudeHome]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const env = { ...inheritedEnv, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome };
    const files = [join(codexHome, 'config.toml'), join(claudeHome, '.claude.json'), join(claudeHome, 'settings.json')];
    const original = [
        '# model comment\nmodel="unmodified" # inline comment\n\n[mcp_servers.keep]\n# keep comment\ncommand="unchanged"\n',
        JSON.stringify({ mcpServers: { keep: { command: 'unchanged' } }, unrelated: { value: 1 } }),
        JSON.stringify({ model: 'unchanged', permissions: { allow: ['Read'] }, hooks: { PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook' }] },
            { matcher: 'mcp__runweft__.*', hooks: [{ type: 'command', command: 'other-observer' }] },
        ] } }),
    ];
    files.forEach((file, index) => writeFileSync(file, original[index], { mode: 0o600 }));
    const native = spawnSync('codex', ['--version'], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(native.status, 0, 'Native MCP install acceptance requires codex on PATH');
    const evidence = { cli, home, codexVersion: native.stdout.trim(), checks: [], success: false };
    const read = () => files.map(file => readFileSync(file, 'utf8'));
    function command(args, expected = 0) {
        const child = spawnSync(cli, ['--home', home, '--json', 'mcp', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
        assert.equal(child.status, expected, child.stderr || String(child.error));
        return JSON.parse(child.stdout);
    }
    function preserved(installed) {
        const raw = read(), codex = getStaticTOMLValue(parseTOML(raw[0]));
        const claude = JSON.parse(raw[1]), settings = JSON.parse(raw[2]);
        assert.equal(codex.model, 'unmodified');
        assert.deepEqual(codex.mcp_servers.keep, { command: 'unchanged' });
        for (const comment of ['# model comment', '# inline comment', '# keep comment']) assert(raw[0].includes(comment));
        assert.deepEqual(claude.mcpServers.keep, { command: 'unchanged' });
        assert.deepEqual(claude.unrelated, { value: 1 });
        assert.equal(settings.model, 'unchanged');
        assert.deepEqual(settings.permissions, { allow: ['Read'] });
        assert.deepEqual(settings.hooks.PreToolUse.slice(0, 2), JSON.parse(original[2]).hooks.PreToolUse);
        if (installed) {
            assert.equal(codex.mcp_servers.runweft.tool_timeout_sec, 600);
            assert.equal(codex.mcp_servers.runweft.env.RUNWEFT_MCP_MANAGED, '1');
            assert(claude.mcpServers.runweft);
            assert.equal(settings.hooks.PreToolUse.length, 3);
        } else {
            assert.equal(codex.mcp_servers.runweft, undefined);
            assert.equal(claude.mcpServers.runweft, undefined);
            assert.equal(settings.hooks.PreToolUse.length, 2);
        }
    }
    try {
        const first = command(['install', '--client', 'all']);
        assert(first.changed); assert.equal(first.files.length, 3);
        assert.equal(statSync(first.backupPath).mode & 0o777, 0o600);
        preserved(true);
        const installed = read();
        assert.equal(command(['install', '--client', 'all']).changed, false);
        assert.deepEqual(read(), installed);
        assert.equal(command(['backups']).backups.length, 1);
        // No service is started here: configuration/handshake pass; offline connection exits 1.
        const check = command(['check', '--client', 'all'], 1);
        assert.equal(check.configurationOk, true); assert.equal(check.connection.running, false);
        assert(check.checks.every(item => item.ok && item.handshake && !item.nativeCallVerified));
        evidence.checks.push('two installs are idempotent; comments, other MCP and hooks retained; installed executable serves both handshakes');
        const removed = command(['uninstall', '--client', 'all']);
        assert(removed.changed); preserved(false);
        assert.equal(command(['uninstall', '--client', 'all']).changed, false);
        assert.equal(command(['backups']).backups.length, 2);
        command(['restore', removed.backupId]); assert.deepEqual(read(), installed);
        command(['restore', first.backupId]); assert.deepEqual(read(), original);
        assert.equal(command(['backups']).backups.length, 4);
        evidence.checks.push('uninstall is idempotent; explicit restore reinstates installed settings then original byte-for-byte snapshots');
        evidence.success = true;
        return evidence;
    } finally { writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
}
