// Passthrough for the native CLI, recording only discovery facts; no prompts or tool inputs.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const child = spawn(process.env.RUNWEFT_SMOKE_CLAUDE, process.argv.slice(2), { stdio: ['inherit', 'pipe', 'inherit'] });
let buffer = '';
child.stdout.on('data', chunk => {
    process.stdout.write(chunk); buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'system' && message.subtype === 'init') appendFileSync(process.env.RUNWEFT_SMOKE_CLAUDE_LOG,
            JSON.stringify({ at: Date.now(), tools: message.tools, nativeSessionId: message.session_id,
                hapiSessionId: process.env.HAPI_SESSION_ID, cwd: process.cwd(), pid: child.pid }) + '\n', { mode: 0o600 });
    }
});
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
process.stdout.on('error', () => child.kill('SIGTERM'));
child.on('error', () => { console.error('Native Claude executable could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
