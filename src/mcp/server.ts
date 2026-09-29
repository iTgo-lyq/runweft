import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pkg from '../../package.json';
import { targetUrl, type ResolvedConfig } from '../config';
import { RunweftError, errorDetails } from '../errors';
import { fetchJson, hapiClient } from '../hapi';
import { bindWorkspace, type Workspace } from '../workspaces';
import { resolveHostIdentity, type HostClient, type HostIdentity } from './identity';
import { taskTools } from './tasks';

export type McpCallContext = { identity: HostIdentity; workspace: Workspace; config: ResolvedConfig; signal: AbortSignal };
export type McpTool = {
    name: string;
    description: string;
    input: z.ZodObject;
    annotations?: Tool['annotations'];
    timeoutMs?: number;
    run: (args: Record<string, unknown>, context: McpCallContext) => Promise<Record<string, unknown>>;
};

const diagnostic: McpTool = {
    name: 'runweft_status',
    description: '检查当前原生会话身份、工作目录和 Runweft 连接。不会启动服务、创建任务或执行模型。',
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    timeoutMs: 10_000,
    async run(_args, { identity, workspace, config, signal }) {
        const url = targetUrl(config.config);
        let connection: Record<string, unknown>;
        try {
            const health = await fetchJson(`${url}/api/runweft/health`, { signal });
            if (health?.service !== 'runweft' || health.protocolVersion !== 1) {
                throw new RunweftError('runweft_unavailable', '目标未提供兼容的 Runweft 服务。', '检查 hub.url；Hub 端需运行 runweft serve。');
            }
            const auth = await hapiClient(config).authenticate(signal);
            connection = { connected: health.ready === true, url, mode: config.config.mode, namespace: auth.namespace };
        } catch (error) {
            signal.throwIfAborted();
            connection = { connected: false, url, mode: config.config.mode, error: errorDetails(error) };
        }
        return { identity, workspace, connection, dataRoot: config.home, resultChannel: 'tool-response', backgroundWake: false };
    },
};

export function productTools(): McpTool[] { return [diagnostic, ...taskTools()]; }

function result(value: Record<string, unknown>, isError = false): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

export function createMcpServer(options: {
    client: HostClient; cwd: string; config: () => ResolvedConfig; tools?: McpTool[];
}) {
    const connection = new AbortController();
    const tools = options.tools ?? productTools();
    const server = new Server({ name: 'runweft', version: pkg.version }, { capabilities: { tools: {} } });
    server.onclose = () => connection.abort(new RunweftError('host_disconnected', '宿主 MCP 连接已关闭。'));
    server.onerror = () => { if (!connection.signal.aborted) console.error('Runweft MCP 协议错误；检查原生客户端与 Runweft 版本。'); };
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => ({
        name: tool.name, description: tool.description, annotations: tool.annotations,
        inputSchema: z.toJSONSchema(tool.input) as Tool['inputSchema'],
    })) }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const tool = tools.find(tool => tool.name === request.params.name);
        if (!tool) return result({ error: { code: 'unknown_tool', message: 'Runweft 没有此工具。' } }, true);
        const deadline = tool.timeoutMs === undefined ? undefined : AbortSignal.timeout(tool.timeoutMs);
        const signal = AbortSignal.any([connection.signal, extra.signal, ...(deadline ? [deadline] : [])]);
        try {
            signal.throwIfAborted();
            const parsed = tool.input.safeParse(request.params.arguments ?? {});
            if (!parsed.success) throw new RunweftError('invalid_tool_arguments', '工具参数不符合声明的格式。', '按工具 inputSchema 修正参数。');
            const config = options.config();
            const identity = resolveHostIdentity(options.client, request.params._meta, options.cwd, config);
            const workspace = bindWorkspace(config, identity.cwd);
            const value = await tool.run(parsed.data, { identity, workspace, config, signal });
            signal.throwIfAborted();
            return result(value);
        } catch (error) {
            const details = signal.aborted
                ? { code: deadline?.aborted ? 'tool_timeout' : 'tool_cancelled', message: deadline?.aborted ? '工具等待超时。' : '工具调用已取消。' }
                : errorDetails(error);
            return result({ error: details }, true);
        }
    });
    return server;
}

export async function serveMcp(client: HostClient, config: () => ResolvedConfig) {
    const server = createMcpServer({ client, cwd: process.cwd(), config });
    const transport = new StdioServerTransport();
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    let done!: () => void;
    const closed = new Promise<void>(resolve => { done = resolve; });
    const onclose = server.onclose;
    const close = () => { void server.close(); };
    server.onclose = () => { onclose?.(); done(); };
    process.stdin.once('end', close);
    process.stdin.once('error', close);
    process.stdout.once('error', close);
    for (const signal of signals) process.once(signal, close);
    try { await server.connect(transport); await closed; }
    finally {
        process.stdin.off('end', close); process.stdin.off('error', close); process.stdout.off('error', close);
        for (const signal of signals) process.off(signal, close);
        await server.close();
    }
}
