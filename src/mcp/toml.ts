import { parseTOML, type AST } from 'toml-eslint-parser';
import { RunweftError } from '../errors';

type Edit = { range: [number, number]; text: string };
const server = ['mcp_servers', 'runweft'];
const own = (path: (string | number)[]) => server.every((key, index) => path[index] === key);
const keys = (key: AST.TOMLKey) => key.keys.map(part => part.type === 'TOMLBare' ? part.name : part.value);

// Only the newly generated server is serialized, never unrelated user configuration.
function inline(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
    if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, value]) => `${JSON.stringify(key)} = ${inline(value)}`).join(', ')} }`;
    throw new RunweftError('codex_config_invalid', '生成的 Codex MCP 定义无法写入 TOML。');
}

/** Replace one semantic server while retaining every unrelated source slice and comment. */
export function replaceCodexMcp(source: string, generated: string, install: boolean): string {
    const ast = parseTOML(source, { tomlVersion: '1.0.0' });
    const next = parseTOML(generated, { tomlVersion: '1.0.0' });
    const edits: Edit[] = [];
    let inlined = false;
    const remove = (range: [number, number]) => { edits.push({ range, text: '' }); };
    function editInline(table: AST.TOMLInlineTable) {
        inlined = true;
        const body = table.body, selected = body.map(pair => keys(pair.key)[0] === 'runweft');
        // Remove contiguous groups with one adjacent comma; preserve other entries verbatim.
        for (let i = 0; i < body.length; i++) {
            if (!selected[i]) continue;
            const start = i;
            while (i + 1 < body.length && selected[i + 1]) i++;
            remove([body[start].range[0], body[i].range[1]]);
            const gap = i + 1 < body.length ? [body[i].range[1], body[i + 1].range[0]]
                : start > 0 ? [body[start - 1].range[1], body[start].range[0]] : null;
            const comma = gap && ast.tokens.find(token => token.value === ',' && token.range[0] >= gap[0] && token.range[1] <= gap[1]);
            if (comma) remove(comma.range);
        }
        if (install) {
            const value = (Bun.TOML.parse(generated) as { mcp_servers: { runweft: unknown } }).mcp_servers.runweft;
            const position = table.range[1] - 1;
            edits.push({ range: [position, position], text: `${selected.some(value => !value) ? ', ' : ' '}runweft = ${inline(value)} ` });
        }
    }
    function visitPair(pair: AST.TOMLKeyValue, parent: (string | number)[]) {
        const path = [...parent, ...keys(pair.key)];
        if (own(path)) remove(pair.range);
        else if (path.length === 1 && path[0] === 'mcp_servers' && pair.value.type === 'TOMLInlineTable') editInline(pair.value);
    }
    for (const node of ast.body[0].body) {
        if (node.type === 'TOMLKeyValue') visitPair(node, []);
        else if (own(node.resolvedKey)) remove(node.range);
        else for (const pair of node.body) visitPair(pair, node.resolvedKey);
    }
    let result = source;
    for (const edit of edits.sort((a, b) => b.range[0] - a.range[0])) {
        result = result.slice(0, edit.range[0]) + edit.text + result.slice(edit.range[1]);
    }
    if (install && !inlined) {
        const eol = source.includes('\r\n') ? '\r\n' : '\n';
        const definition = next.body[0].body.filter(node => node.type === 'TOMLTable' && own(node.resolvedKey))
            .map(node => generated.slice(...node.range).replace(/\r?\n/g, eol)).join(eol + eol);
        if (!definition) throw new RunweftError('codex_config_invalid', 'Codex 未生成 Runweft MCP 定义。');
        result += `${result && !result.endsWith('\n') ? eol : ''}${definition}${eol}`;
    }
    return result;
}
