import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { dataPaths, type ResolvedConfig } from './config';
import { RunweftError, errorDetails } from './errors';
import { fetchJson, HapiRequestError, runHapi } from './hapi';
import { readMachineConnection } from './hub/resources/connection';

export function runnerProcessAlive(c: ResolvedConfig) {
    const path = join(dataPaths(c).hapiClient, 'runner.state.json');
    if (!existsSync(path)) return false;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(state.pid) || state.pid <= 0) return false;
    try { process.kill(state.pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
export function machineConnection(c: ResolvedConfig) {
    if (!c.config.hub.url) throw new RunweftError('hub_connection_required', '启动 Runner 前需要明确 Hub 地址。', '先使用 hub connect begin/complete，或设置 hub.url。');
    const record = readMachineConnection(c.home, c.config.hub.url);
    if (!record?.machineId || !record.active.credentialId) throw new RunweftError('machine_enrollment_required', '本机尚未完成此 Hub 的机器登记。', '先执行 hub machine enroll；登记不会创建 runtime 或 Agent。');
    return record;
}
async function machineRequest(record: ReturnType<typeof machineConnection>, path: string, options: RequestInit = {}) {
    try { return await fetchJson(record.hub + path, { ...options, redirect: 'error' }); }
    catch (error) {
        const details = errorDetails(error), clean = (value?: string) => value?.split(record.active.token).join('[redacted]');
        throw new HapiRequestError(error instanceof HapiRequestError ? error.status : 503, clean(details.code)!, clean(details.message)!, clean(details.hint));
    }
}
export async function runnerStatus(c: ResolvedConfig) {
    const base = { credentialFile: dataPaths(c).machineConnection, nativeHome: dataPaths(c).hapiClient, running: runnerProcessAlive(c) };
    let record: ReturnType<typeof machineConnection>;
    try { record = machineConnection(c); }
    catch (error) { return { ...base, registered: false, online: false, error: errorDetails(error) }; }
    const registered = { ...base, registered: true, ownerId: record.ownerId, machineId: record.machineId, credentialId: record.active.credentialId, credentialPending: !!record.pending };
    try {
        const result = base.running ? await machineRequest(record, `/cli/machines/${record.machineId}`, {
            headers: { authorization: `Bearer ${record.active.token}` }, signal: AbortSignal.timeout(1500) }) : null;
        return { ...registered, online: result?.machine?.active === true, error: null };
    } catch (error) { return { ...registered, online: false, error: errorDetails(error) }; }
}
async function waitRunner(check: () => Promise<boolean>, message: string) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(150); }
    throw new RunweftError('runner_timeout', message, '使用 runner status / doctor 核对凭据，并查看 paths 显示的原生 Runner 日志。');
}
export async function startRunner(c: ResolvedConfig) {
    const record = machineConnection(c);
    if (record.pending) throw new RunweftError('machine_rotation_pending', '机器凭据替换尚未完成。', '先重跑 hub machine rotate-credential 完成原请求，再启动 Runner。');
    // Validate the saved machine credential independently from the current business identity.
    const health = await machineRequest(record, '/api/runweft/health', { redirect: 'error' });
    if (health?.service !== 'runweft' || health?.capabilities?.hubAccess !== 1) throw new RunweftError('hub_access_unavailable', '目标 Hub 尚未启用独立机器授权。', '升级配套 Hub 后重新接入。');
    const reply = await machineRequest(record, '/api/auth', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: record.active.token }) });
    const claims = decodeJwt(reply.token);
    if (claims.kind !== 'machine' || claims.sub !== record.active.credentialId) throw new RunweftError('machine_credential_mismatch', '保存的机器凭据与 Hub 登记不一致。', '完成机器凭据轮换后重启 Runner。');
    if (!(await runnerStatus(c)).online) {
        const result = await runHapi(c, ['runner', 'start'], true);
        if (result.code) throw new RunweftError('runner_start_failed', 'HAPI Runner 启动失败。', `查看 ${dataPaths(c).hapiClient}/logs。`);
        await waitRunner(async () => (await runnerStatus(c)).online, 'Runner 未能连接所选 Hub。');
    }
    return runnerStatus(c);
}
export async function stopRunner(c: ResolvedConfig) {
    if (!runnerProcessAlive(c)) return { stopped: true, alreadyStopped: true };
    const result = await runHapi(c, ['runner', 'stop'], true);
    if (result.code) throw new RunweftError('runner_stop_failed', 'HAPI Runner 未能停止。', `查看 ${dataPaths(c).hapiClient}/logs。`);
    await waitRunner(async () => !runnerProcessAlive(c), 'Runner 尚未完成关闭。');
    return { stopped: true, alreadyStopped: false };
}
