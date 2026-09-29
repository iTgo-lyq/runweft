import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

/** Read-only native inventory probe through HAPI's existing shared gateway; not an executor. */
export async function codexCatalog(hapiHome: string, hapiSessionId: string, threadId: string, hostPid: number) {
    const directory = join(hapiHome, 'codex-runtimes');
    const runtime = readdirSync(directory).filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')))
        .find(runtime => runtime.pid === hostPid && runtime.sessions?.[hapiSessionId]?.active);
    if (!runtime) throw new Error('No HAPI shared runtime registry for the test session');
    const endpoint = runtime.endpoint.startsWith('unix://') ? `ws+unix://${runtime.endpoint.slice(7)}:/` : runtime.endpoint;
    const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${runtime.token}`, Host: 'localhost' } });
    let sequence = 0;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    const fail = (error: unknown) => {
        for (const request of pending.values()) request.reject(error instanceof Error ? error : new Error('Native inventory connection failed'));
        pending.clear();
    };
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('Native inventory connection closed')));
    socket.on('message', data => {
        const message = JSON.parse(data.toString());
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`Native inventory request failed: ${message.error.message}`));
        else request.resolve(message.result);
    });
    const request = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
        const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const timer = setTimeout(() => { fail(new Error('Native MCP inventory timed out')); socket.terminate(); }, 15_000);
    try {
        await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        await request('initialize', { clientInfo: { name: 'runweft-acceptance-inventory', version: '1' }, capabilities: { experimentalApi: true } });
        socket.send(JSON.stringify({ method: 'initialized' }));
        const servers: Array<{ name: string; tools: Record<string, unknown> }> = [];
        let cursor: string | undefined;
        do {
            const page = await request('mcpServerStatus/list', { threadId, cursor, limit: 100, detail: 'toolsAndAuthOnly' });
            servers.push(...page.data); cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return servers.map(server => ({ name: server.name, tools: Object.keys(server.tools) }));
    } finally { clearTimeout(timer); socket.close(); }
}
