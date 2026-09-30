import { readFileSync, writeFileSync } from 'node:fs';
import { parseTOML } from 'toml-eslint-parser';

// Explicit smoke overrides apply only after the harness copies native configuration.
export function configureSmokeCodexModel(path: string) {
    const model = process.env.RUNWEFT_SMOKE_CODEX_MODEL, effort = process.env.RUNWEFT_SMOKE_CODEX_EFFORT;
    let content = readFileSync(path, 'utf8');
    const overrides = Object.entries({ model, model_reasoning_effort: effort }).filter((entry): entry is [string, string] => !!entry[1]);
    if (overrides.length) {
        const keys = new Set(overrides.map(([key]) => key));
        const edits = parseTOML(content).body[0].body.filter(node => node.type === 'TOMLKeyValue' && node.key.keys.length === 1
            && keys.has(node.key.keys[0].type === 'TOMLBare' ? node.key.keys[0].name : node.key.keys[0].value));
        for (const node of edits.reverse()) content = content.slice(0, node.range[0]) + content.slice(node.range[1]);
        content = overrides.map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join('') + content;
        writeFileSync(path, content, { mode: 0o600 });
    }
    const config = Bun.TOML.parse(content) as { model?: string; model_reasoning_effort?: string };
    return { model: config.model, reasoningEffort: config.model_reasoning_effort };
}
