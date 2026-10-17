import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getProjectPath } from '../../hapi/cli/src/claude/utils/path';
import type { Flavor, NativeFixture } from './native-fixture';

function history(directory: string, id: string): string {
    const found: string[] = [];
    function visit(path: string) {
        if (!existsSync(path)) return;
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const file = join(path, entry.name);
            if (entry.isDirectory()) visit(file); else if (entry.name.endsWith('.jsonl') && entry.name.includes(id)) found.push(file);
        }
    }
    visit(directory); assert.equal(found.length, 1, 'Expected one actual native transcript'); return found[0]!;
}
export async function recovery(f: NativeFixture, flavor: Flavor, longPath = false) {
    const project = longPath ? join(f.project, 'a'.repeat(110), 'b'.repeat(110)) : f.project;
    mkdirSync(project, { recursive: true });
    const cli = (args: string[]) => f.cli(args, project), marker = `RECONSTRUCTION_MEMORY_${crypto.randomUUID()}`, currentMarker = `CURRENT_${crypto.randomUUID()}`;
    const agent = f.agent(flavor), accepted = cli(['task', 'spawn', agent.id, '--message',
        `记住 ${marker}，不写入文件，不调用工具、不委派。只回复 FIRST_ROUND_OK。记忆标记不得出现在正文或结构化报告的任何字段，summary 只写 FIRST_ROUND_OK，其他字段为空。`]);
    const first = await f.complete(accepted.agent_id); assert.equal(first.status, 'completed'); assert(first.report.text.includes('FIRST_ROUND_OK')); assert(!first.report.text.includes(marker));
    const nativeHome = flavor === 'codex' ? f.env.CODEX_HOME! : f.env.CLAUDE_CONFIG_DIR!;
    const original = history(nativeHome, first.native_session_id), before = createHash('sha256').update(readFileSync(original)).digest('hex');
    if (longPath) {
        assert(project.length > 200); assert.equal(original, join(nativeHome, 'projects', basename(getProjectPath(project)), first.native_session_id + '.jsonl'));
    } else {
        // Only this completed case's native history moves aside. Product business records stay in place.
        f.stopRunners();
        for (const file of f.models.copies.filter(file => file.startsWith(nativeHome + '/'))) f.models.copies.push(file.replace(nativeHome + '/', nativeHome + '.retained/'));
        renameSync(nativeHome, nativeHome + '.retained'); mkdirSync(nativeHome, { mode: 0o700 });
        for (const name of flavor === 'codex' ? ['config.toml', 'auth.json'] : ['settings.json', '.credentials.json', '.claude.json']) {
            const retained = join(nativeHome + '.retained', name);
            if (existsSync(retained)) { copyFileSync(retained, join(nativeHome, name)); rmSync(retained); }
        }
        cli(['runner', 'start']);
    }
    cli(['task', 'send', accepted.agent_id, '--message', `从提供的历史中回忆上一轮要求记住的 RECONSTRUCTION_MEMORY_ 标记，回复原标记和 ${currentMarker}。不重新执行旧任务，不调用工具、不读写文件、不委派。`]);
    const second = await f.complete(accepted.agent_id); assert.equal(second.status, 'completed'); assert(second.report.text.includes(marker)); assert(second.report.text.includes(currentMarker));
    if (longPath) {
        assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.session_id, first.session_id); assert(!second.reconstruction);
    } else {
        assert.equal(second.resume.outcome, 'missing'); assert.equal(second.reconstruction.reason, 'native_session_missing');
        assert.deepEqual(second.reconstruction.source_round_ids, [first.round_id]); assert.notEqual(second.native_session_id, first.native_session_id);
        const retained = original.replace(nativeHome + '/', nativeHome + '.retained/');
        assert.equal(createHash('sha256').update(readFileSync(retained)).digest('hex'), before);
        const transcript = readFileSync(history(nativeHome, second.native_session_id), 'utf8');
        const users = transcript.trim().split('\n').map(line => JSON.parse(line)).filter(event => flavor === 'codex'
            ? event.type === 'response_item' && event.payload?.type === 'message' && event.payload.role === 'user'
            : event.type === 'user' && event.message?.role === 'user');
        const matches = users.filter(v => JSON.stringify(v).includes(currentMarker)); assert.equal(matches.length, 1); assert(JSON.stringify(matches[0]).includes(marker));
    }
    assert.deepEqual(cli(['task', 'show', accepted.agent_id, '--round', first.round_id]).report, first.report);
    return { taskId: accepted.agent_id, rounds: 2, reconstructed: !longPath, cwdLength: project.length, memoryRetained: true };
}
