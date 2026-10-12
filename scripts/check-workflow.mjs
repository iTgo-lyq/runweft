import { readFile, readdir } from 'node:fs/promises';
import { validateChange, validateWorkflow } from '../.agents/skills/spec-trail/scripts/state-schema.mjs';
import { cyclicNodes, parseTaskOrder } from '../.agents/skills/spec-trail/scripts/task-order.mjs';

const root = new URL('../docs/project/', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const errors = validateWorkflow(await read('workflow.json')).map(e => `workflow.json: ${e}`);
const states = new Map();
for (const category of ['changes', 'archive']) {
    const directories = await readdir(new URL(category + '/', root), { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    for (const directory of directories.filter(entry => entry.isDirectory())) {
        const path = `${category}/${directory.name}`;
        const state = await read(`${path}/change.json`);
        errors.push(...validateChange(state).map(error => `${path}: ${error}`));
        if (states.has(state.id)) errors.push(`${path}: duplicate Change id ${state.id}`);
        states.set(state.id, state);
        const expected = category === 'archive' ? directory.name.slice(11) : directory.name;
        if (state.id !== expected) errors.push(`${path}: id does not match directory`);
        if (category === 'archive' && (state.status !== 'completed' || state.stage !== 'close'
            || state.closure?.archive?.path !== `docs/project/${path}`)) errors.push(`${path}: invalid archive identity`);
        const plan = await readFile(new URL(`${path}/plan.md`, root), 'utf8').catch(error => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        });
        // A paused draft can legitimately have no Plan yet.
        if (plan !== undefined || ['execution', 'close'].includes(state.stage)) {
            const order = parseTaskOrder(state, plan, `${path}/plan.md`);
            if (['invalid', 'missing'].includes(order.status)) errors.push(`${path}: ${JSON.stringify(order.diagnostics)} (${order.status})`);
        }
        if (plan) {
            const headings = [...plan.matchAll(/^#{2,4} (T[1-9][0-9]*)\s+(.+)$/gm)];
            const titles = new Map(headings.map(([, id, title]) => [id, title]));
            if (headings.length !== titles.size) errors.push(`${path}: duplicate Plan task heading`);
            for (const [id, task] of Object.entries(state.tasks)) {
                if (titles.get(id) !== task.title) errors.push(`${path}: ${id} title differs between Plan and JSON`);
            }
            for (const id of titles.keys()) if (!state.tasks[id]) errors.push(`${path}: ${id} missing from JSON`);
        }
    }
}
const edges = {};
for (const [id, state] of states) {
    edges[id] = state.dependsOn ?? [];
    for (const target of edges[id]) if (!states.has(target)) errors.push(`${id}: missing dependency ${target}`);
}
for (const id of cyclicNodes(edges)) errors.push(`${id}: cyclic Change dependencies`);
if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else console.log(`Validated workflow and ${states.size} Changes, including task order, titles and dependency graph.`);
