// Read-only probe for explicit native acceptance, never a production tool.
import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const record = event => appendFileSync(process.env.RUNWEFT_SMOKE_PROBE_LOG, JSON.stringify({
    at: Date.now(), pid: process.pid, cwd: process.cwd(), hapiSessionId: process.env.HAPI_SESSION_ID, event,
}) + '\n', { mode: 0o600 });
const server = new Server({ name: 'keep-probe', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'probe_report',
    description: 'Read-only Runweft acceptance probe. Returns PROBE_OK.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
}] }));
server.setRequestHandler(CallToolRequestSchema, async () => { record('call'); return { content: [{ type: 'text', text: 'PROBE_OK' }] }; });
record('start');
await server.connect(new StdioServerTransport());
process.stdin.once('end', () => { void server.close(); });
