import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { ensureDirectory, type ResolvedConfig } from '../config';
import { errorDetails, RunweftError } from '../errors';
import { FlavorSchema, type Problem } from '../resources/types';

export const AgentIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ScopeSchema = z.enum(['global', 'project']);
export type AgentScope = z.infer<typeof ScopeSchema>;
const nullable = (value: unknown) => typeof value === 'string' ? value.trim() || null : value ?? null;
const optionalText = z.preprocess(nullable, z.string().nullable());
export const DefinitionSchema = z.strictObject({
    schemaVersion: z.literal(1).default(1), name: z.string().trim().min(1).optional(),
    description: z.string().default(''), instructions: z.string().default(''),
    runtime: z.preprocess(nullable, z.uuid().nullable()),
    flavor: z.preprocess(nullable, FlavorSchema.nullable()), model: optionalText, reasoningEffort: optionalText,
}).superRefine((value, ctx) => {
    if ((value.model || value.reasoningEffort) && !value.flavor) ctx.addIssue({ code: 'custom', path: ['flavor'], message: '配置模型或推理参数时必须填写 codex 或 claude' });
});
export type AgentDefinition = Omit<z.infer<typeof DefinitionSchema>, 'name'> & { name: string };
export type AgentContext = { sourceCwd: string; projectRoot: string; gitCommonDir: string | null; globalDirectory: string; projectDirectory: string };
export type AgentSource = { scope: AgentScope; path: string; key: string; linkTarget: string | null };
export type AgentDocument = {
    id: string; definition: AgentDefinition; definitionVersion: string;
    context: AgentContext; source: AgentSource; shadowed: { scope: AgentScope; path: string }[];
};
export type AgentFileError = { id: string | null; scope: AgentScope; path: string; error: Problem };
export type AgentCatalog = { context: AgentContext; agents: AgentDocument[]; errors: AgentFileError[] };

export function contentVersion(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function agentId(value: string) {
    if (!AgentIdSchema.safeParse(value).success) throw new RunweftError('agent_id_invalid', 'Agent 标识需以小写字母开头，只包含小写字母、数字和连字符，最多 64 字符。');
    return value;
}
export function agentScope(value?: string): AgentScope | undefined {
    if (value === undefined) return undefined;
    const parsed = ScopeSchema.safeParse(value);
    if (!parsed.success) throw new RunweftError('agent_scope_invalid', 'Agent 作用域只支持 global 或 project。');
    return parsed.data;
}
function exists(path: string) {
    try { lstatSync(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** The caller supplies the verified host cwd; an MCP server's own cwd is not a project identity. */
export function agentContext(c: ResolvedConfig, cwd: string): AgentContext {
    if (!isAbsolute(cwd)) throw new RunweftError('agent_cwd_invalid', 'Agent 解析需要宿主的绝对工作目录。');
    const sourceCwd = realpathSync(cwd);
    if (!statSync(sourceCwd).isDirectory()) throw new RunweftError('agent_cwd_invalid', 'Agent 工作目录必须是已存在的目录。');
    const git = spawnSync('git', ['-C', sourceCwd, 'rev-parse', '--show-toplevel', '--git-common-dir'], { encoding: 'utf8', env: { ...c.env, LC_ALL: 'C' } });
    if (git.error) throw new RunweftError('git_unavailable', '无法运行 Git 来定位 Agent 项目。', '安装 Git 后重试。');
    const globalDirectory = join(c.home, 'agents');
    let projectRoot = sourceCwd, gitCommonDir: string | null = null;
    if (git.status === 0) {
        const [root, common] = git.stdout.trimEnd().split('\n');
        projectRoot = realpathSync(root!); gitCommonDir = realpathSync(resolve(sourceCwd, common!));
    } else {
        if (!git.stderr.includes('not a git repository')) throw new RunweftError('agent_git_failed', 'Git 无法解析当前工作区。', git.stderr.trim());
        const userHome = c.env.HOME ?? homedir();
        const homePath = exists(userHome) ? realpathSync(userHome) : resolve(userHome);
        const globalPath = exists(globalDirectory) ? realpathSync(globalDirectory) : globalDirectory;
        for (let directory = sourceCwd; directory !== homePath; directory = dirname(directory)) {
            const candidate = join(directory, '.runweft', 'agents');
            if (exists(candidate) && realpathSync(candidate) !== globalPath) { projectRoot = directory; break; }
            if (directory === dirname(directory)) break;
        }
    }
    return { sourceCwd, projectRoot, gitCommonDir, globalDirectory, projectDirectory: join(projectRoot, '.runweft', 'agents') };
}
function directory(context: AgentContext, scope: AgentScope) { return scope === 'global' ? context.globalDirectory : context.projectDirectory; }
function sourceKey(context: AgentContext, scope: AgentScope, id: string) {
    return scope === 'global' ? `global/${id}` : `${context.gitCommonDir ? 'git' : 'project'}/${context.gitCommonDir ?? context.projectRoot}/${id}`;
}
function fileProblem(path: string, message: string, hint = '修正此定义后重试；不会退回被遮蔽的全局定义。') {
    return new RunweftError('agent_definition_invalid', `${path}：${message}`, hint);
}
function read(context: AgentContext, id: string, scope: AgentScope, shadowed: AgentDocument['shadowed']): AgentDocument {
    const path = join(directory(context, scope), `${id}.yaml`);
    if (exists(join(directory(context, scope), `${id}.yml`))) throw fileProblem(join(directory(context, scope), `${id}.yml`), '不支持 .yml 扩展名。', '将定义改名为 .yaml；同名文件只能保留一份。');
    const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
    if (document.errors.length) {
        const issue = document.errors[0]!;
        const at = issue.linePos?.[0];
        throw fileProblem(path, `YAML 无效${at ? `（${at.line}:${at.col}）` : ''}，${issue.code}。`);
    }
    const parsed = DefinitionSchema.safeParse(document.toJS());
    if (!parsed.success) throw fileProblem(path, parsed.error.issues.map(issue => `${issue.path.join('.') || 'definition'}: ${issue.message}`).join('\n'));
    const value = parsed.data;
    const definition: AgentDefinition = { schemaVersion: value.schemaVersion, name: value.name ?? id, description: value.description, instructions: value.instructions, runtime: value.runtime, flavor: value.flavor, model: value.model, reasoningEffort: value.reasoningEffort };
    return { id, definition, definitionVersion: contentVersion(definition), context, shadowed,
        source: { scope, path, key: sourceKey(context, scope, id), linkTarget: lstatSync(path).isSymbolicLink() ? realpathSync(path) : null } };
}
function has(context: AgentContext, scope: AgentScope, id: string) {
    return ['yaml', 'yml'].some(extension => exists(join(directory(context, scope), `${id}.${extension}`)));
}
function selected(context: AgentContext, id: string, scope?: AgentScope) {
    const effective = scope ?? (has(context, 'project', id) ? 'project' : 'global');
    if (!has(context, effective, id)) throw new RunweftError('agent_unknown', `找不到 Agent：${id}${scope ? `（${scope}）` : ''}。`, '运行 runweft agent list 查看定义，或 runweft agent init <id> 创建。');
    const shadowed: AgentDocument['shadowed'] = effective === 'project' && has(context, 'global', id)
        ? [{ scope: 'global', path: join(context.globalDirectory, `${id}.${exists(join(context.globalDirectory, `${id}.yaml`)) ? 'yaml' : 'yml'}`) }] : [];
    return read(context, id, effective, shadowed);
}
export function readAgent(c: ResolvedConfig, cwd: string, id: string, scope?: AgentScope): AgentDocument {
    return selected(agentContext(c, cwd), agentId(id), scope);
}
export function listAgents(c: ResolvedConfig, cwd: string): AgentCatalog {
    const context = agentContext(c, cwd), ids = new Set<string>();
    const errors: AgentFileError[] = [];
    for (const scope of ['global', 'project'] as const) {
        const path = directory(context, scope);
        if (!exists(path)) continue;
        for (const file of readdirSync(path).sort()) {
            if (!/\.ya?ml$/.test(file)) continue;
            const id = file.replace(/\.ya?ml$/, '');
            if (AgentIdSchema.safeParse(id).success) ids.add(id);
            else errors.push({ id: null, scope, path: join(path, file), error: errorDetails(fileProblem(join(path, file), '文件名不是有效 Agent 标识。', '使用小写字母开头的字母、数字、连字符，最长 64 字符。')) });
        }
    }
    const agents: AgentDocument[] = [];
    for (const id of [...ids].sort()) {
        try { agents.push(selected(context, id)); }
        catch (error) {
            const scope = has(context, 'project', id) ? 'project' : 'global';
            errors.push({ id, scope, path: join(directory(context, scope), `${id}.${exists(join(directory(context, scope), `${id}.yml`)) ? 'yml' : 'yaml'}`), error: errorDetails(error) });
        }
    }
    return { context, agents, errors };
}
export function initAgent(c: ResolvedConfig, cwd: string, id: string, options: { scope?: AgentScope; name?: string; runtime?: string } = {}) {
    agentId(id);
    const context = agentContext(c, cwd), scope = options.scope ?? 'global';
    const path = join(directory(context, scope), `${id}.yaml`);
    const definition = DefinitionSchema.safeParse({ name: options.name ?? id, runtime: options.runtime });
    if (!definition.success) throw fileProblem(path, definition.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
    if (has(context, scope, id)) throw new RunweftError('agent_exists', `Agent 文件已存在：${path}`, '直接编辑现有定义，或使用其他标识。');
    ensureDirectory(dirname(path));
    writeFileSync(path, '# Agent 职责定义；直接编辑本文件。项目同名定义整体覆盖全局定义。\n'
        + '# description 用于发现；instructions 随每次任务传入。\n'
        + '# runtime 留空便于共享；用 runweft agent bind <id> --runtime <ID> 设置个人目标。\n'
        + '# model / reasoningEffort 留空继承原生默认；非空时必须指定 flavor: codex 或 claude。\n'
        + stringify(definition.data), { flag: 'wx', mode: 0o600 });
    return read(context, id, scope, []);
}
