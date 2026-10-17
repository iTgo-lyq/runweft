import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTOML } from 'toml-eslint-parser';
import { ExecutionClient } from '../../src/execution';
import { alive, until, type Flavor, type NativeFixture } from './native-fixture';

export async function controls(f: NativeFixture, flavor: Flavor) {
    const path = join(f.env.CODEX_HOME!, 'config.toml');
    if (flavor === 'codex') {
        let config = readFileSync(path, 'utf8');
        const edits = parseTOML(config).body[0].body.filter(node => node.type === 'TOMLKeyValue' && node.key.keys.length === 1
            && ['approval_policy', 'sandbox_mode'].includes(node.key.keys[0].type === 'TOMLBare' ? node.key.keys[0].name : node.key.keys[0].value));
        for (const node of edits.reverse()) config = config.slice(0, node.range[0]) + config.slice(node.range[1]);
        writeFileSync(path, 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n' + config);
    }
    const agent = f.agent(flavor), cli = f.cli;
    let taskId = '', permissions = 0;
    for (const decision of ['approved', 'denied'] as const) {
        const file = join(f.root, `${flavor}-${decision}.txt`);
        const action = flavor === 'codex'
            ? `使用 exec_command，sandbox_permissions=require_escalated，执行 python3 -c 'from pathlib import Path; Path("${file}").write_text("APPROVAL_PROBE")'，justification 说明专用目录审批验证。`
            : `使用 Write 工具向 ${file} 写入一行 APPROVAL_PROBE，末尾换行可选，不使用 Bash。`;
        const message = `唯一任务：${action} 被拒绝时不重试、不换工具。不委派。然后回复 FINISHED。`;
        const accepted = cli(['task', taskId ? 'send' : 'spawn', taskId || agent.id, '--message', message]); taskId = accepted.agent_id;
        const handled = new Set<string>();
        await until(() => {
            const current = cli(['task', 'show', taskId]);
            assert(!['unknown', 'failed'].includes(current.status), `Native task ${current.status}`);
            assert(current.status !== 'needs_attention' || current.attention?.code === 'permission_required', 'Native task needs non-permission attention');
            for (const [id, request] of Object.entries(current.permissions ?? {}) as [string, any][]) {
                if (handled.has(id)) continue;
                assert(JSON.stringify(request.arguments).includes(file), 'Unexpected permission target'); handled.add(id);
                cli(['task', 'permission', taskId, '--round', current.round_id, '--request', id, '--decision', decision]);
            }
            return current;
        }, value => ['completed', 'interrupted'].includes(value.status), 'permission completion');
        const result = await f.complete(taskId);
        assert.equal(result.status, flavor === 'claude' && decision === 'denied' ? 'interrupted' : 'completed');
        assert(handled.size > 0); permissions += handled.size;
        assert.equal(existsSync(file), decision === 'approved');
        if (decision === 'approved') assert.match(readFileSync(file, 'utf8'), /^APPROVAL_PROBE(?:\r?\n)?$/);
    }
    if (flavor === 'codex') {
        const slow = cli(['task', 'send', taskId, '--message', '运行 sleep 20，结束后回复 SLOW_DONE，不修改文件、不委派。']);
        await until(() => cli(['task', 'show', taskId]), v => v.round_id === slow.round_id && v.inputs[0]?.observation?.phase === 'accepted', 'steer target');
        const steered = cli(['task', 'send', taskId, '--steer', '--round', slow.round_id, '--message', '本轮最终报告必须包含 STEER_NATIVE_OK。']);
        await until(() => cli(['task', 'show', taskId]), v => v.inputs.some((i: any) => i.id === steered.input_id && ['steered', 'invoked'].includes(i.steer?.status)), 'steer delivery');
        assert((await f.complete(taskId)).report.text.includes('STEER_NATIVE_OK'));
    }
    const slow = cli(['task', 'send', taskId, '--message', '运行 sleep 60，结束后回复 WAIT_DONE。不修改文件、不委派。']);
    const busy = await until(() => cli(['task', 'show', taskId]), v => v.round_id === slow.round_id && v.inputs[0]?.observation?.phase === 'accepted', 'interrupt target');
    cli(['task', 'interrupt', taskId, '--round', slow.round_id]);
    const interrupted = await f.complete(taskId); assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.inputs[0].observation.executionId, busy.inputs[0].observation.executionId);
    if (flavor === 'codex') {
        // One focused native session pair exercises HAPI's shared-host ownership, outside managed Task auto-archival.
        const execution = new ExecutionClient(f.runner.http);
        const started = await execution.start(f.runner.machineId, { requestId: crypto.randomUUID(), directory: f.project, agent: flavor,
            startingMode: 'remote', permissionMode: 'default', model: f.selections.codex.model });
        assert(started.outcome === 'recorded' && started.receipt.sessionId);
        const id = started.receipt.sessionId, session = await execution.waitUntilReady(id), pid = session.metadata!.hostPid!; f.pids.add(pid);
        const firstInput = crypto.randomUUID(); await execution.send(id, { localId: firstInput, text: '只回复 SIBLING_BASE，不使用工具。' });
        await until(() => execution.query(id, firstInput), v => v.facts.some(f => f.observation.phase === 'completed') && !v.session.thinking, 'sibling base');
        const sibling = (await f.runner.http.request(`/api/sessions/${id}/fork`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).sessionId;
        assert.equal((await execution.waitUntilReady(sibling)).metadata?.hostPid, pid);
        assert.equal((await execution.stop(id)).outcome, 'stopped'); assert(alive(pid));
        const input = crypto.randomUUID(); await execution.send(sibling, { localId: input, text: '只回复 SIBLING_ALIVE，不使用工具。' });
        const result = await until(() => execution.query(sibling, input), v => v.facts.some(f => f.observation.phase === 'completed') && !v.session.thinking, 'live sibling');
        assert(result.output.some(o => o.text.includes('SIBLING_ALIVE'))); assert.equal((await execution.stop(sibling)).outcome, 'stopped');
        await until(() => alive(pid), value => !value, 'sibling host exit', 10_000);
    }
    return { taskId, rounds: interrupted.rounds.length, permissions, steer: flavor === 'codex', siblingIsolation: flavor === 'codex', interrupted: true };
}
