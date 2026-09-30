import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { RunweftError } from './errors';

export const hubOrigin = z.string().refine(value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            && !url.search && !url.hash && url.pathname === '/';
    } catch { return false; }
}, '使用 HTTP(S) 根地址，不包含路径、凭据或查询参数').transform(value => new URL(value).origin);
const origin = hubOrigin;
const port = z.number().int().min(1).max(65535);
const artifactDefaults = { maxFileMiB: 512, namespaceQuotaGiB: 10, unreferencedDays: 7, pendingHours: 24 };
const artifactSettings = z.strictObject({
    maxFileMiB: z.number().int().min(1).max(65_536).default(artifactDefaults.maxFileMiB),
    namespaceQuotaGiB: z.number().int().min(1).max(1_048_576).default(artifactDefaults.namespaceQuotaGiB),
    unreferencedDays: z.number().int().min(1).max(3650).default(artifactDefaults.unreferencedDays),
    pendingHours: z.number().int().min(1).max(8760).default(artifactDefaults.pendingHours),
});

const configFields = z.strictObject({
    schemaVersion: z.literal(1).default(1),
    mode: z.enum(['local', 'hub']).default('local'),
    server: z.strictObject({
        host: z.string().min(1).default('127.0.0.1'),
        port: port.default(3210),
        publicUrl: origin.optional(),
        hapiPort: port.optional(),
        runner: z.boolean().default(false),
        artifacts: artifactSettings.default(artifactDefaults),
    }).default({ host: '127.0.0.1', port: 3210, runner: false, artifacts: artifactDefaults }),
    hub: z.strictObject({
        url: origin.optional(),
    }).default({}),
    hapi: z.strictObject({ executable: z.string().min(1).optional() }).default({}),
});
export const configSchema = configFields.superRefine((config, ctx) => {
    if (config.mode === 'hub' && !config.hub.url) {
        ctx.addIssue({ code: 'custom', path: ['hub', 'url'], message: 'Hub 模式需要填写服务地址' });
    }
    if (config.server.hapiPort === config.server.port) {
        ctx.addIssue({ code: 'custom', path: ['server', 'hapiPort'], message: '不能与 server.port 相同；省略即可自动选择' });
    }
});

export type Config = z.infer<typeof configSchema>;
export type ResolvedConfig = {
    home: string;
    file: string;
    exists: boolean;
    config: Config;
    sources: Record<string, string>;
    env: NodeJS.ProcessEnv;
};

const overrides: Record<string, string[]> = {
    RUNWEFT_MODE: ['mode'],
    RUNWEFT_HUB_URL: ['hub', 'url'],
    RUNWEFT_PORT: ['server', 'port'],
    RUNWEFT_HOST: ['server', 'host'],
    RUNWEFT_PUBLIC_URL: ['server', 'publicUrl'],
    RUNWEFT_HAPI_EXECUTABLE: ['hapi', 'executable'],
};

export function expandPath(value: string): string {
    return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}

export function configPath(homeOption?: string, env: NodeJS.ProcessEnv = process.env): string {
    return join(expandPath(homeOption || env.RUNWEFT_HOME || join(homedir(), '.runweft')), 'config.yaml');
}

export function ensureDirectory(path: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function atomicWrite(path: string, content: string) {
    ensureDirectory(dirname(path));
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, path);
}

function documentAt(file: string) {
    const document = parseDocument(existsSync(file) ? readFileSync(file, 'utf8') : '{}', { uniqueKeys: true });
    if (document.errors.length) {
        const location = document.errors[0].linePos?.[0];
        throw new RunweftError('invalid_config', `配置 YAML 无效${location ? `（第 ${location.line} 行）` : ''}。`, `检查 ${file}`);
    }
    return document;
}

export function validateConfig(value: unknown, complete = true): Config {
    const result = (complete ? configSchema : configFields).safeParse(value);
    if (!result.success) {
        const issues = result.error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`);
        throw new RunweftError('invalid_config', issues.join('\n'), '运行 runweft config path 定位配置文件。');
    }
    return result.data;
}

export function loadConfig(homeOption?: string, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
    const file = configPath(homeOption, env);
    const home = dirname(file);
    const exists = existsSync(file);
    const document = documentAt(file);
    // Validate the file first so environment overrides cannot hide malformed persisted settings.
    const raw = document.toJS() ?? {};
    validateConfig(raw, false);
    for (const [key, path] of Object.entries(overrides)) {
        if (env[key] !== undefined) document.setIn(path, key === 'RUNWEFT_PORT' ? Number(env[key]) : env[key]);
    }
    const config = validateConfig(document.toJS());
    const sources: Record<string, string> = {};
    function visit(object: Record<string, unknown>, prefix: string[] = []) {
        for (const [key, value] of Object.entries(object)) {
            const path = [...prefix, key];
            if (value && typeof value === 'object') visit(value as Record<string, unknown>, path);
            else {
                const override = Object.entries(overrides).find(([name, keys]) => env[name] !== undefined && keys.join('.') === path.join('.'));
                const fromFile = path.reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, raw);
                sources[path.join('.')] = override ? `env:${override[0]}` : fromFile !== undefined ? file : 'default';
            }
        }
    }
    visit(config);
    sources.home = homeOption ? '--home' : env.RUNWEFT_HOME ? 'env:RUNWEFT_HOME' : 'default';
    return { home, file, exists, config, sources, env };
}

export function initializeConfig(homeOption?: string, options: { mode?: string; url?: string } = {}, env = process.env) {
    const home = expandPath(homeOption || env.RUNWEFT_HOME || join(homedir(), '.runweft'));
    const file = join(home, 'config.yaml');
    if (existsSync(file)) return { ...loadConfig(home, env), created: false };
    const config = validateConfig({ mode: options.mode ?? (options.url ? 'hub' : 'local'), hub: options.url ? { url: options.url } : {} });
    const header = '# Runweft 全局配置；配置说明：runweft config show\n'
        + '# local 托管本机 Hub；hub 使用已有服务。hub.url 是独立的业务连接地址。\n'
        + '# 使用 hub connect begin/complete 连接身份与空间；token 不写入此文件。\n'
        + '# 首次只启动 Hub；登记本机后使用 runner start，或显式启用 server.runner。\n'
        + '# server.publicUrl 用于反向代理；hapiPort 留空会自动选择。\n'
        + '# server.artifacts 只设置本机托管服务；远端限制用 artifact limits 查询。\n';
    atomicWrite(file, header + stringify(config));
    return { ...loadConfig(home, env), created: true };
}

export function setConfig(resolved: ResolvedConfig, key: string, value: string) {
    const document = documentAt(resolved.file);
    const scalar = parseDocument(value);
    if (scalar.errors.length) throw new RunweftError('invalid_value', '配置值不是有效 YAML。');
    document.setIn(key.split('.'), scalar.toJS());
    validateConfig(document.toJS(), false);
    const effective = document.clone();
    for (const [name, path] of Object.entries(overrides)) {
        if (resolved.env[name] !== undefined) effective.setIn(path, name === 'RUNWEFT_PORT' ? Number(resolved.env[name]) : resolved.env[name]);
    }
    validateConfig(effective.toJS());
    atomicWrite(resolved.file, document.toString());
    return loadConfig(resolved.home, resolved.env);
}

export function connectionName(config: Pick<Config, 'mode' | 'hub'>): string {
    const url = config.hub.url;
    if (!url) return 'unconnected';
    const label = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '-');
    return `${label}-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
}

export function localUrl(config: Config): string { return `http://127.0.0.1:${config.server.port}`; }
export function targetUrl(config: Config): string { return config.hub.url ?? localUrl(config); }

export function dataPaths(resolved: ResolvedConfig) {
    const { home, config } = resolved;
    const server = join(home, 'server');
    const connection = join(home, 'connections', connectionName(config)), hapiClient = join(connection, 'hapi');
    return {
        home, config: resolved.file, agents: join(home, 'agents'),
        server, hapiServer: join(server, 'hapi'), runweftServer: join(server, 'runweft'),
        state: join(server, 'runweft', 'state.sqlite'),
        hapiClient, taskWorkspaces: join(hapiClient, 'workspaces', 'environments'),
        connection, identityConnection: join(connection, 'identity.json'), pendingConnection: join(connection, 'connect.json'),
        machineConnection: join(connection, 'machine.json'),
        repositoryCaches: join(hapiClient, 'workspaces', 'repositories'), repositoryExports: join(hapiClient, 'workspaces', 'exports'), repositoryImports: join(hapiClient, 'workspaces', 'imports'),
        repositoryFetches: join(hapiClient, 'workspaces', 'fetches'),
        artifacts: join(server, 'hapi', 'artifacts'), artifactTransfers: join(hapiClient, 'artifact-transfers'),
        bindings: join(home, 'client.sqlite'), process: join(server, 'process.json'),
        logs: join(home, 'logs'), backups: join(home, 'backups'), cache: join(home, 'cache'), temporary: join(home, 'tmp'),
        nativeCodex: resolved.env.CODEX_HOME || join(homedir(), '.codex'),
        nativeClaude: resolved.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    };
}
