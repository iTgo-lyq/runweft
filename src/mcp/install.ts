import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomicWrite, dataPaths, type ResolvedConfig } from '../config';
import { RunweftError, errorDetails } from '../errors';
import { selfCommand, status } from '../services';
import { hostClientSchema, type HostClient } from './identity';
import { codexMcpDefinition, replaceCodexMcp } from './toml';

type JsonObject = Record<string, any>;
export type ConfigChange = { path: string; before: string | null; after: string | null };
const backupSchema = z.object({
    id: z.string().uuid(), createdAt: z.string(), operation: z.string(),
    changes: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() })),
});
const marker = { RUNWEFT_MCP_MANAGED: '1' };
const matcher = 'mcp__runweft__.*';
const codexToolTimeout = 600;
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : null;
const target = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path);

export function clientFiles(c: ResolvedConfig, client: HostClient): string[] {
    const home = c.env.HOME || homedir();
    if (client === 'codex') return [join(c.env.CODEX_HOME || join(home, '.codex'), 'config.toml')];
    const directory = c.env.CLAUDE_CONFIG_DIR;
    return directory ? [join(directory, '.claude.json'), join(directory, 'settings.json')]
        : [join(home, '.claude.json'), join(home, '.claude', 'settings.json')];
}

export function selectedClients(c: ResolvedConfig, selection?: string): HostClient[] {
    if (selection === 'all') return ['codex', 'claude'];
    if (selection !== undefined) {
        const client = hostClientSchema.safeParse(selection);
        if (!client.success) throw new RunweftError('unsupported_host', '选择 codex、claude 或 all。');
        return [client.data];
    }
    const clients = hostClientSchema.options.filter(client => Bun.which(client, { PATH: c.env.PATH }) || clientFiles(c, client).some(existsSync));
    if (!clients.length) throw new RunweftError('host_not_found', '未检测到 Codex 或 Claude Code。', '安装原生客户端，或用 --client codex|claude 指定配置目标。');
    return clients;
}

function parse(text: string | null, path: string, toml = false): JsonObject {
    try {
        const value = text === null ? {} : toml ? Bun.TOML.parse(text) : JSON.parse(text);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Do not include config values in diagnostics. */ }
    throw new RunweftError('host_config_invalid', '原生客户端配置无法解析，未修改文件。', `检查 ${path}`);
}

function object(value: unknown, path: string): JsonObject {
    if (value === undefined) return {};
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
    throw new RunweftError('host_config_invalid', '原生配置中的 MCP 或 hook 容器格式无效。', `检查 ${path}`);
}

function entry(c: ResolvedConfig, client: HostClient, launch: string[]) {
    const [command, ...prefix] = launch;
    return { command, args: [...prefix, '--home', c.home, 'mcp', 'serve', '--client', client], env: marker,
        ...(client === 'codex' ? { tool_timeout_sec: codexToolTimeout } : {}) };
}
function managed(value: any): boolean { return value?.env?.RUNWEFT_MCP_MANAGED === '1'; }
function ownedHook(value: any): boolean {
    return value?.type === 'command' && Array.isArray(value.args) && value.args.at(-2) === 'mcp' && value.args.at(-1) === 'hook'
        && value.args.includes('--home');
}
type RemovalScope = { executables: string[] };
function inRemovalScope(c: ResolvedConfig, value: any, scope?: RemovalScope): boolean {
    if (!scope) return true;
    const args = value?.args;
    const index = Array.isArray(args) ? args.indexOf('--home') : -1;
    const home = index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : undefined;
    const resolved = home && resolve(home.startsWith('~/') ? join(c.env.HOME || homedir(), home.slice(2)) : home);
    if (resolved === c.home) return true;
    let command = value?.command;
    try { if (typeof command === 'string' && existsSync(command)) command = realpathSync(command); } catch { /* Keep the original command for matching. */ }
    if (scope.executables.includes(command)) throw new RunweftError('uninstall_mcp_other_home', '此安装的 MCP 或 hook 使用了另一个数据目录，未修改配置。',
        `先核对${home ? ` ${home}` : '该注册的 --home'}，再从其数据目录执行卸载。`);
    return false;
}
function withoutServer(value: JsonObject) {
    const copy = structuredClone(value);
    if (copy.mcp_servers) {
        delete copy.mcp_servers.runweft;
        if (!Object.keys(copy.mcp_servers).length) delete copy.mcp_servers;
    }
    return copy;
}

function codexChange(c: ResolvedConfig, install: boolean, launch: string[], scope?: RemovalScope): ConfigChange[] {
    const path = target(clientFiles(c, 'codex')[0]);
    const before = read(path), config = parse(before, path, true);
    const current = object(config.mcp_servers, path).runweft;
    if (install && current && !managed(current)) throw new RunweftError('mcp_name_conflict', 'Codex 已有非 Runweft 管理的 runweft MCP 条目。', `先在 ${path} 重命名该条目，再安装。`);
    if ((!install && !managed(current)) || (install && isDeepStrictEqual(current, entry(c, 'codex', launch)))) return [];
    if (!install && !inRemovalScope(c, current, scope)) return [];
    if (!install) {
        const after = replaceCodexMcp(before!, '', false);
        if (!isDeepStrictEqual(withoutServer(config), withoutServer(parse(after, path, true)))) {
            throw new RunweftError('codex_config_unexpected_change', '移除 MCP 会影响其他 Codex 配置，未修改文件。', `检查 ${path}`);
        }
        return [{ path, before, after }];
    }
    const codex = Bun.which('codex', { PATH: c.env.PATH });
    if (!codex) throw new RunweftError('codex_missing', '需要 Codex 原生命令来编辑 TOML 配置。', '安装 Codex 并确认 codex 在 PATH 中。');
    const staging = join(dataPaths(c).temporary, `mcp-${randomUUID()}`);
    try {
        atomicWrite(join(staging, 'config.toml'), before ?? '');
        const invoke = (args: string[]) => {
            const result = spawnSync(codex, ['mcp', ...args], { env: { ...c.env, CODEX_HOME: staging }, encoding: 'utf8', timeout: 15_000 });
            if (result.error || result.status !== 0) throw new RunweftError('codex_config_edit_failed', 'Codex 原生配置编辑未成功，原文件未修改。', `检查 ${path} 及 codex --version。`);
        };
        if (managed(current)) invoke(['remove', 'runweft']);
        if (install) {
            const next = entry(c, 'codex', launch);
            invoke(['add', '--env', 'RUNWEFT_MCP_MANAGED=1', 'runweft', '--', next.command, ...next.args]);
        }
        const native = parse(read(join(staging, 'config.toml')), path, true);
        const generated = install ? codexMcpDefinition({ ...native.mcp_servers.runweft, tool_timeout_sec: codexToolTimeout }) : '';
        const after = replaceCodexMcp(before ?? '', generated, install);
        const next = parse(after, path, true);
        if (!isDeepStrictEqual(withoutServer(config), withoutServer(next))
            || !isDeepStrictEqual(next.mcp_servers?.runweft, install ? entry(c, 'codex', launch) : undefined)) {
            throw new RunweftError('codex_config_unexpected_change', 'Codex 编辑器修改了 Runweft 以外的配置，已放弃写入。', `原配置保留在 ${path}。`);
        }
        return [{ path, before, after }];
    } finally { rmSync(staging, { recursive: true, force: true }); }
}

function claudeChanges(c: ResolvedConfig, install: boolean, launch: string[], scope?: RemovalScope): ConfigChange[] {
    const [mcpPath, settingsPath] = clientFiles(c, 'claude').map(target);
    const mcpBefore = read(mcpPath), settingsBefore = read(settingsPath);
    const mcp = parse(mcpBefore, mcpPath), settings = parse(settingsBefore, settingsPath);
    const originalMcp = structuredClone(mcp), originalSettings = structuredClone(settings);
    const servers = object(mcp.mcpServers, mcpPath);
    if (install && servers.runweft && !managed(servers.runweft)) throw new RunweftError('mcp_name_conflict', 'Claude Code 已有非 Runweft 管理的 runweft MCP 条目。', `先在 ${mcpPath} 重命名该条目，再安装。`);
    if (install) mcp.mcpServers = { ...servers, runweft: { type: 'stdio', ...entry(c, 'claude', launch) } };
    else if (managed(servers.runweft) && inRemovalScope(c, servers.runweft, scope)) { delete servers.runweft; if (!Object.keys(servers).length) delete mcp.mcpServers; }
    const hooks = object(settings.hooks, settingsPath);
    if (hooks.PreToolUse !== undefined && !Array.isArray(hooks.PreToolUse)) throw new RunweftError('host_config_invalid', 'Claude PreToolUse 必须是数组。', `检查 ${settingsPath}`);
    const previous: JsonObject[] = hooks.PreToolUse ?? [];
    const next = previous.flatMap(rule => {
        object(rule, settingsPath);
        if (rule.matcher !== matcher || !Array.isArray(rule.hooks)) return [rule];
        const others = rule.hooks.filter((hook: unknown) => !ownedHook(hook) || !inRemovalScope(c, hook, scope));
        return others.length ? [{ ...rule, hooks: others }] : [];
    });
    if (install) next.push({ matcher, hooks: [{ type: 'command', command: launch[0], args: [...launch.slice(1), '--home', c.home, 'mcp', 'hook'] }] });
    if (next.length) { hooks.PreToolUse = next; settings.hooks = hooks; }
    else { delete hooks.PreToolUse; if (!Object.keys(hooks).length) delete settings.hooks; }
    return [
        { path: mcpPath, before: mcpBefore, after: isDeepStrictEqual(mcp, originalMcp) ? mcpBefore : JSON.stringify(mcp, null, 2) + '\n' },
        { path: settingsPath, before: settingsBefore, after: isDeepStrictEqual(settings, originalSettings) ? settingsBefore : JSON.stringify(settings, null, 2) + '\n' },
    ];
}

const backupDirectory = (c: ResolvedConfig) => join(c.home, 'backups', 'mcp');
function writeContent(path: string, content: string | null) { if (content === null) { if (existsSync(path)) unlinkSync(path); } else atomicWrite(path, content); }

/** All candidates are prepared before writing; a failed multi-file edit rolls back only our own writes. */
export function applyConfigChanges(c: ResolvedConfig, operation: string, candidates: ConfigChange[], write = writeContent, backup = true) {
    const changes = candidates.filter(change => change.before !== change.after);
    if (!changes.length) return { changed: false, files: [] as string[], backupId: null, backupPath: null };
    for (const change of changes) {
        if (read(change.path) !== change.before) throw new RunweftError('host_config_changed', '配置在准备期间被其他进程修改，已停止操作。', `重新检查 ${change.path} 后再运行命令。`);
    }
    const id = backup ? randomUUID() : null, path = id ? join(backupDirectory(c), `${id}.json`) : null;
    if (path) atomicWrite(path, JSON.stringify({ id, createdAt: new Date().toISOString(), operation, changes }, null, 2));
    const written: ConfigChange[] = [];
    try {
        for (const change of changes) {
            if (read(change.path) !== change.before) throw new Error('Configuration changed during write');
            write(change.path, change.after); written.push(change);
        }
    } catch {
        const unresolved: string[] = [];
        for (const change of written.reverse()) {
            try {
                if (read(change.path) !== change.after) { unresolved.push(change.path); continue; }
                writeContent(change.path, change.before);
            } catch { unresolved.push(change.path); }
        }
        throw new RunweftError('mcp_config_write_failed', unresolved.length ? '配置写入失败；部分文件有后续修改或无法回退，已保留现场。' : '配置写入失败；本次已写入的文件均已回退。',
            `${path ? `备份：${path}` : '完整卸载未生成磁盘备份；修复配置写入问题后重试。'}${unresolved.length ? `\n需检查：${unresolved.join('、')}` : ''}`);
    }
    return { changed: true, files: changes.map(change => change.path), backupId: id, backupPath: path };
}

export function configureMcp(c: ResolvedConfig, install: boolean, selection?: string, launch = selfCommand([])) {
    const clients = selectedClients(c, selection);
    const changes = prepareMcpChanges(c, install, clients, launch);
    return { clients, ...applyConfigChanges(c, install ? 'install' : 'uninstall', changes) };
}

export function prepareMcpChanges(c: ResolvedConfig, install: boolean, clients: HostClient[] = ['codex', 'claude'], launch = selfCommand([]), scope?: RemovalScope) {
    return clients.flatMap(client => client === 'codex' ? codexChange(c, install, launch, scope) : claudeChanges(c, install, launch, scope));
}

export function listMcpBackups(c: ResolvedConfig) {
    const directory = backupDirectory(c);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
        const parsed = backupSchema.safeParse(JSON.parse(readFileSync(join(directory, name), 'utf8')));
        if (!parsed.success) throw new RunweftError('mcp_backup_invalid', 'MCP 备份文件无效。', `检查 ${join(directory, name)}`);
        const backup = parsed.data;
        return { id: backup.id, createdAt: backup.createdAt, operation: backup.operation, files: backup.changes.map(change => change.path) };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreMcp(c: ResolvedConfig, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new RunweftError('mcp_backup_invalid', '请使用备份 ID。', '运行 runweft mcp backups 查看可用备份。');
    const file = join(backupDirectory(c), `${id}.json`), text = read(file);
    if (text === null) throw new RunweftError('mcp_backup_missing', '找不到此 MCP 备份。', '运行 runweft mcp backups 查看可用备份。');
    let backup: z.infer<typeof backupSchema>;
    try { backup = backupSchema.parse(JSON.parse(text)); }
    catch { throw new RunweftError('mcp_backup_invalid', 'MCP 备份内容无效。', `检查 ${file}`); }
    return applyConfigChanges(c, `restore:${id}`, backup.changes.map(change => ({ ...change, before: change.after, after: change.before })));
}

export async function checkMcp(c: ResolvedConfig, selection?: string) {
    const clients = selectedClients(c, selection), checks = [];
    for (const client of clients) {
        const files = clientFiles(c, client);
        try {
            const config = parse(read(files[0]), files[0], client === 'codex');
            const current = object(client === 'codex' ? config.mcp_servers : config.mcpServers, files[0]).runweft;
            if (!managed(current)) throw new RunweftError('mcp_not_installed', '未找到 Runweft 管理的 MCP 配置。', `运行 runweft mcp install --client ${client}。`);
            if (current.enabled === false) throw new RunweftError('mcp_disabled', 'Runweft MCP 已在原生配置中禁用。', `运行 runweft mcp install --client ${client} 重新启用。`);
            if (client === 'codex' && !(typeof current.tool_timeout_sec === 'number' && current.tool_timeout_sec >= codexToolTimeout)) {
                throw new RunweftError('mcp_timeout_outdated', 'Codex MCP 超时不足以等待子任务结果。', '运行 runweft mcp install --client codex 更新到 600 秒；检查命令不会自动修改配置。');
            }
            if (typeof current.command !== 'string' || !Array.isArray(current.args) || current.args.some((v: unknown) => typeof v !== 'string')) throw new RunweftError('mcp_command_invalid', 'Runweft MCP 启动命令无效。', '重新运行 runweft mcp install。');
            const index = current.args.indexOf('--home');
            if (index < 0 || current.args[index + 1] !== c.home) {
                throw new RunweftError('mcp_home_mismatch', 'MCP 注册使用了另一个 Runweft 数据目录。', `注册目录：${index >= 0 ? current.args[index + 1] : '未指定'}；使用 --home 选择该目录后检查，或重新安装以切换。`);
            }
            if (client === 'claude') {
                const settings = parse(read(files[1]), files[1]);
                const hooks = object(settings.hooks, files[1]).PreToolUse;
                if (!Array.isArray(hooks) || !hooks.some(rule => rule.matcher === matcher && Array.isArray(rule.hooks) && rule.hooks.some(ownedHook))) {
                    throw new RunweftError('claude_hook_missing', 'Claude MCP 身份 hook 未安装。', '运行 runweft mcp install --client claude。');
                }
                const args = [...current.args.slice(0, current.args.indexOf('mcp')), 'mcp', 'hook'];
                if (!hooks.some(rule => rule.matcher === matcher && rule.hooks?.some((hook: any) => ownedHook(hook) && hook.command === current.command && isDeepStrictEqual(hook.args, args)))) {
                    throw new RunweftError('claude_hook_mismatch', 'Claude 身份 hook 与 MCP 指向不同的程序或数据目录。', '运行 runweft mcp install --client claude 一起更新。');
                }
            }
            const transport = new StdioClientTransport({ command: current.command, args: current.args,
                env: Object.fromEntries(Object.entries({ ...c.env, ...current.env }).filter(([, value]) => typeof value === 'string')) as Record<string, string>, stderr: 'pipe' });
            // Drain, but never copy native stderr (which can contain user settings) into diagnostics.
            transport.stderr?.on('data', () => {});
            const connection = new Client({ name: 'runweft-mcp-check', version: '1' });
            try {
                await connection.connect(transport, { timeout: 5_000 });
                const tools = await connection.listTools({}, { timeout: 5_000 });
                if (!tools.tools.some(tool => tool.name === 'runweft_status')) throw new RunweftError('mcp_wrong_server', '入口未提供 Runweft 诊断工具。', '重新运行 runweft mcp install。');
            } finally { await connection.close(); }
            checks.push({ client, files, ok: true, command: current.command, home: index >= 0 ? current.args[index + 1] : null, handshake: true, nativeCallVerified: false });
        } catch (error) { checks.push({ client, files, ok: false, error: errorDetails(error) }); }
    }
    let connection: Record<string, unknown>;
    try { connection = await status(c); }
    catch (error) { connection = { running: false, error: errorDetails(error) }; }
    const configurationOk = checks.every(check => check.ok);
    return { ok: configurationOk && (connection.connection as { connected?: boolean } | undefined)?.connected === true, configurationOk, checks, mode: c.config.mode, dataRoot: c.home, connection };
}
