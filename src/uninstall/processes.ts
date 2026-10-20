import { readFileSync, realpathSync, readdirSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { RunweftError } from '../errors';
import { within, type Installation } from './installation';
import { regularPath } from './files';

type ProcessInfo = { pid: number; command: string; marker: string };
type Session = { pid: number; happySessionId: string; marker: string };
export type ManagedProcess = { kind: 'hub' | 'runner' | 'mcp'; pid: number; marker: string; file?: string; url?: string; instanceId?: string; sessions?: Session[] };
function ps(args: string[]) {
    const result = spawnSync('ps', args, { encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
    if (result.error || result.status !== 0) return '';
    return result.stdout.trim();
}
function info(pid: number): ProcessInfo | null {
    if (!Number.isInteger(pid) || pid <= 0) throw new RunweftError('uninstall_process_unknown', '服务记录中的 PID 无效。');
    const command = ps(['-p', String(pid), '-ww', '-o', 'command=']);
    const state = ps(['-p', String(pid), '-o', 'state=']);
    if (state.startsWith('Z')) return null;
    if (!command || !state) {
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return null; }
        throw new RunweftError('uninstall_process_unknown', '无法核对仍存活的进程，未删除数据。', `检查 PID ${pid}。`);
    }
    let marker = ps(['-p', String(pid), '-o', 'lstart=']);
    if (process.platform === 'linux') {
        try { marker = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')[19]!; } catch { return null; }
    }
    if (!marker) {
        // The process can exit after command/state were read but before lstart.
        // Only a confirmed exit is safe; a live or inaccessible PID still blocks removal.
        if (ps(['-p', String(pid), '-o', 'state=']).startsWith('Z')) return null;
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return null; }
        throw new RunweftError('uninstall_process_unknown', '无法核对服务进程。', `检查 PID ${pid}；未删除数据。`);
    }
    return { pid, command, marker };
}
function hapiHome(pid: number): string | undefined {
    if (process.platform === 'linux') {
        try { return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(value => value.startsWith('HAPI_HOME='))?.slice(10); }
        catch { return undefined; }
    }
    return ps(['-Eww', '-p', String(pid), '-o', 'command=']).match(/(?:^| )HAPI_HOME=(.*?)(?= [A-Za-z_][A-Za-z0-9_]*=|$)/)?.[1];
}
async function request(url: string, body?: object) {
    try {
        const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), redirect: 'error' });
        if (response.ok) return await response.json();
    } catch { /* Never print native control responses or credentials. */ }
    throw new RunweftError('uninstall_process_unknown', '无法验证或停止本机服务。', '检查服务/Runner 状态，确认已退出后重试卸载；未删除数据。');
}
function assertControlPort(pid: number, port: number) {
    let owned = false;
    if (process.platform === 'linux') {
        try {
            const sockets = new Set(readdirSync(`/proc/${pid}/fd`).flatMap(fd => {
                try { const match = readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/); return match ? [match[1]] : []; }
                catch { return []; }
            }));
            for (const table of ['tcp', 'tcp6']) {
                for (const line of readFileSync(`/proc/${pid}/net/${table}`, 'utf8').split('\n').slice(1)) {
                    const fields = line.trim().split(/\s+/);
                    if (fields[3] === '0A' && Number.parseInt(fields[1]?.split(':')[1] ?? '', 16) === port && sockets.has(fields[9])) owned = true;
                }
            }
        } catch { /* Refuse unverified ownership. */ }
    } else {
        const result = spawnSync('lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'n'], { encoding: 'utf8', timeout: 5000 });
        owned = !result.error && result.status === 0 && result.stdout.split('\n').some(line => line.startsWith('n') && line.endsWith(`:${port}`));
    }
    if (!owned) throw new RunweftError('uninstall_process_unknown', 'Runner 控制端口不属于记录中的进程，未发送请求。', `检查 PID ${pid} 的 Runner 状态文件。`);
}
function ancestors() {
    const output = ps(['-ax', '-o', 'pid=,ppid=']);
    if (!output) throw new RunweftError('uninstall_process_unknown', '无法核对卸载进程的父进程。');
    const parents = new Map(output.split('\n').map(line => line.trim().split(/\s+/).map(Number)).map(([pid, parent]) => [pid!, parent!]));
    const result = new Set<number>([process.pid]);
    for (let pid = process.ppid; pid && !result.has(pid); pid = parents.get(pid) ?? 0) result.add(pid);
    return result;
}
async function sessions(current: ManagedProcess): Promise<Session[]> {
    assertControlPort(current.pid, Number(new URL(current.url!).port));
    const result = await request(current.url! + '/list', {});
    if (!Array.isArray(result?.children)) throw new RunweftError('uninstall_process_unknown', 'Runner 会话列表无法验证。');
    const selected = new Map<number, Session>();
    for (const child of result.children) {
        if (!Number.isInteger(child.pid) || typeof child.happySessionId !== 'string') throw new RunweftError('uninstall_process_unknown', 'Runner 会话身份无法验证。');
        const process = info(child.pid);
        if (process) selected.set(child.pid, { pid: child.pid, happySessionId: child.happySessionId, marker: process.marker });
    }
    try {
        const recovered = JSON.parse(readFileSync(current.file! + '.resume-processes.json', 'utf8'));
        if (!Array.isArray(recovered)) throw new Error();
        for (const child of recovered) {
            if (!Number.isInteger(child.pid) || typeof child.requestedSessionId !== 'string' || typeof child.processStartMarker !== 'string') throw new Error();
            const process = info(child.pid);
            // HAPI stores the ps lstart marker on Linux/macOS; a changed PID generation is not a stop target.
            if (process && ps(['-p', String(child.pid), '-o', 'lstart=']) === child.processStartMarker) {
                selected.set(child.pid, { pid: child.pid, happySessionId: child.confirmedSessionId ?? child.requestedSessionId, marker: process.marker });
            }
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new RunweftError('uninstall_process_unknown', 'Runner 恢复进程记录无法验证。', `检查 ${current.file}.resume-processes.json；未删除数据。`);
    }
    return [...selected.values()];
}
export async function inspectManagedProcesses(home: string, connections: string[], installation: Installation): Promise<ManagedProcess[]> {
    const managed: ManagedProcess[] = [];
    const states: ['hub' | 'runner', string][] = [['hub', join(home, 'server', 'process.json')], ...connections.map(root => ['runner', join(root, 'hapi', 'runner.state.json')] as ['runner', string])];
    for (const [kind, file] of states) {
        if (!regularPath(home, file)) continue;
        let record: any;
        try { record = JSON.parse(readFileSync(file, 'utf8')); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw new RunweftError('uninstall_process_unknown', '本机服务状态文件损坏。', `检查 ${file} 并确认进程已退出后再卸载。`);
        }
        const current = info(record.pid);
        if (!current) continue;
        if (kind === 'hub') {
            if (!current.command.startsWith(installation.executable + ' ') || !current.command.includes(`--home ${home} serve`)) {
                throw new RunweftError('uninstall_process_unknown', 'Hub PID 不属于此次安装与数据目录。', `检查 ${file}；未发送信号。`);
            }
            let address: URL;
            try { address = new URL(record.url); } catch { throw new RunweftError('uninstall_process_unknown', 'Hub 状态地址无效。'); }
            if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || address.pathname !== '/' || address.username || address.password || address.search || address.hash) {
                throw new RunweftError('uninstall_process_unknown', 'Hub 状态未指向本机受管服务。');
            }
            const health = await request(address.origin + '/api/runweft/health');
            if (health?.service !== 'runweft' || health.instanceId !== record.instanceId) throw new RunweftError('uninstall_process_unknown', 'Hub 实例归属不一致，未发送信号。');
            managed.push({ kind, pid: current.pid, marker: current.marker, file, url: address.origin, instanceId: record.instanceId });
        } else {
            if (!/\brunner start-sync(?:\s|$)/.test(current.command) || hapiHome(current.pid) !== file.slice(0, -'/runner.state.json'.length)
                || !Number.isInteger(record.httpPort) || record.httpPort < 1 || record.httpPort > 65535) {
                throw new RunweftError('uninstall_process_unknown', 'Runner PID 或控制端口归属无法确认。', `检查 ${file}；未发送停止请求。`);
            }
            const url = `http://127.0.0.1:${record.httpPort}`;
            const runner: ManagedProcess = { kind, pid: current.pid, marker: current.marker, file, url };
            runner.sessions = await sessions(runner);
            managed.push(runner);
        }
    }
    for (const current of installedProcesses(installation)) {
        if (current.command.includes(`--home ${home} mcp serve`)) managed.push({ kind: 'mcp', pid: current.pid, marker: current.marker });
    }
    const parents = ancestors();
    if (managed.some(current => parents.has(current.pid) || current.sessions?.some(session => parents.has(session.pid)))) {
        throw new RunweftError('uninstall_process_ancestor', '卸载命令正在受管会话内运行，停止该会话会中断卸载。', '在独立终端执行完整卸载。');
    }
    return managed;
}
function installedProcesses(installation: Installation) {
    const output = ps(['-ax', '-ww', '-o', 'pid=,command=']);
    if (!output) throw new RunweftError('uninstall_process_unknown', '无法检查运行中的程序，未执行卸载。', '确认 ps 可用后重试。');
    const processes: ProcessInfo[] = [], parents = ancestors();
    for (const line of output.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) continue;
        const pid = Number(match[1]), command = match[2]!;
        if (parents.has(pid)) continue;
        let executable = '';
        if (process.platform === 'linux') try { executable = realpathSync(`/proc/${pid}/exe`); } catch { /* Foreign UID or exited process. */ }
        const dataHome = installation.dataHome, nativeHome = dataHome ? hapiHome(pid) : undefined;
        if ((nativeHome && dataHome && within(dataHome, nativeHome))
            || [installation.executable, installation.hapi].some(path => executable === path || command === path || command.startsWith(path + ' '))) {
            const current = info(pid); if (current) processes.push(current);
        }
    }
    return processes;
}
export function assertNoOtherInstalledProcesses(installation: Installation, managed: ManagedProcess[]) {
    const allowed = new Set(managed.flatMap(value => [value.pid, ...(value.sessions?.map(session => session.pid) ?? [])]));
    const output = ps(['-ax', '-o', 'pid=,ppid=']);
    const parents = new Map(output.split('\n').map(line => line.trim().split(/\s+/).map(Number)).map(([pid, parent]) => [pid!, parent!]));
    const unexpected = installedProcesses(installation).filter(current => {
        const seen = new Set<number>();
        for (let pid = current.pid; pid && !seen.has(pid); pid = parents.get(pid) ?? 0) {
            if (allowed.has(pid)) return false;
            seen.add(pid);
        }
        return true;
    });
    if (unexpected.length) throw new RunweftError('uninstall_process_busy', '此次安装还有无法归入本数据目录的进程，未开始卸载。', `先结束 PID ${unexpected.map(value => value.pid).join('、')} 对应的任务或其他 --home 实例。`);
}
export function assertNoInstalledProcesses(installation: Installation) {
    const processes = installedProcesses(installation);
    if (processes.length) throw new RunweftError('uninstall_process_busy', '此次安装仍有进程在运行，未删除程序和数据。', `先结束 PID ${processes.map(value => value.pid).join('、')} 对应的任务或其他 --home 实例，再重试。`);
}
async function waitStopped(current: ManagedProcess) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (info(current.pid)?.marker !== current.marker) return;
        await Bun.sleep(100);
    }
    throw new RunweftError('uninstall_process_busy', '服务尚未完成退出，未删除数据。', `检查 PID ${current.pid}，退出后重试卸载。`);
}
export async function stopManagedProcesses(processes: ManagedProcess[]) {
    // Stop tracked native sessions before their Runner control server is closed.
    for (const current of processes.filter(value => value.kind === 'runner')) {
        if (info(current.pid)?.marker !== current.marker) continue;
        for (const child of await sessions(current)) {
            const stopped = await request(current.url! + '/stop-session', { sessionId: child.happySessionId });
            if (!['stopped', 'already_gone'].includes(stopped?.status)) throw new RunweftError('uninstall_process_busy', '受管会话尚未停止，未删除数据。', `先结束会话 ${child.happySessionId} 后重试。`);
            await waitStopped({ kind: 'runner', pid: child.pid, marker: child.marker });
        }
        const response = await request(current.url! + '/stop', {});
        if (response?.status !== 'stopping') throw new RunweftError('uninstall_process_busy', 'Runner 未确认退出。');
        await waitStopped(current);
    }
    for (const current of processes.filter(value => value.kind !== 'runner')) {
        if (info(current.pid)?.marker !== current.marker) continue;
        if (current.kind === 'hub') {
            const health = await request(current.url! + '/api/runweft/health');
            if (health?.instanceId !== current.instanceId) throw new RunweftError('uninstall_process_unknown', 'Hub 实例已改变，未发送停止信号。');
        }
        process.kill(current.pid, 'SIGTERM');
        await waitStopped(current);
    }
}
