// Native-host acceptance proxy. Cuts one actual stdio connection only after a
// DISCONNECT_PROBE next-round acceptance has been returned to the parent.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
const log = process.env.RUNWEFT_SMOKE_CUT_LOG;
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ['pipe', 'pipe', 'inherit'] });
const requests = new Map();
let input = '', output = '', armed, cutting = false;
process.stdin.on('data', chunk => {
    input += chunk;
    let end;
    while ((end = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, end); input = input.slice(end + 1);
        let call; try { call = JSON.parse(line); } catch { child.stdin.write(line + '\n'); continue; }
        if (call.method === 'tools/call') {
            requests.set(call.id, { name: call.params.name, cut: call.params.name === 'send_input' && call.params.arguments?.message?.includes('DISCONNECT_PROBE') });
            if (call.params.name === 'wait' && armed && log && !existsSync(log)) {
                cutting = true;
                appendFileSync(log, JSON.stringify({ at: Date.now(), cwd: process.cwd(), pid: process.pid, childPid: child.pid,
                    agentId: armed.agent_id, roundId: armed.round_id, ids: call.params.arguments.ids }) + '\n', { mode: 0o600 });
                child.kill('SIGTERM'); return;
            }
        }
        if (!cutting) child.stdin.write(line + '\n');
    }
});
child.stdout.on('data', chunk => {
    process.stdout.write(chunk); output += chunk;
    let end;
    while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        let reply; try { reply = JSON.parse(line); } catch { continue; }
        const request = requests.get(reply.id); requests.delete(reply.id);
        if (request?.cut && reply.result?.structuredContent?.accepted) armed = reply.result.structuredContent;
    }
});
process.stdin.once('end', () => child.stdin.end());
process.stdin.once('error', () => child.kill('SIGTERM'));
process.stdout.once('error', () => child.kill('SIGTERM'));
child.stdin.on('error', () => {});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.once('error', () => { process.stdin.destroy(); process.exitCode = 1; });
child.once('exit', code => { process.stdin.destroy(); process.exitCode = cutting ? 0 : code ?? 1; });
