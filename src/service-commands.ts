import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { localUrl, type ResolvedConfig } from './config';
import { runHapi } from './hapi';
import { HubClient } from './hub/client';
import { hubOptions } from './hub/delegation/client';
import { IdentityConnection } from './hub/connect/client';
import { machineConnection, runnerStatus, startRunner, stopRunner } from './runner';
import { RunweftError } from './errors';
import { doctor, requireRunweft, serve, serviceState, start, status, stop } from './services';

type Output = (value: unknown, human: string) => void;

export async function browserAddress(target: string, native = false) {
    await requireRunweft(target);
    const url = new URL(native ? '/' : '/hub', target).toString();
    return { url, publicUrl: url };
}

function summary(value: Awaited<ReturnType<typeof status>>) {
    return `${value.role} · ${value.url}\n`
        + `托管 Hub：${value.service.running ? '已运行' : '未运行'} · 身份/空间连接：${value.connection.connected ? '有效' : '未连接'}\n`
        + `Runner：${value.runner.online ? '在线' : value.runner.running ? '进程运行但未连接' : '未启动'}\n`
        + `数据目录：${value.dataRoot}`
        + (value.restartRequired ? '\n已安装版本与运行版本不同，请运行 runweft restart。' : '');
}

export function addServiceCommands(program: Command, context: () => ResolvedConfig, output: Output) {
    program.command('start').description('本地模式启动服务；Hub 模式连接本机 Runner').action(async () => {
        const value = await start(context()); output(value, `${summary(value)}\n打开界面：runweft open`);
    });
    program.command('status').description('查看当前目标与本机 Runner 的真实状态').action(async () => {
        const value = await status(context()); output(value, summary(value));
    });
    program.command('stop').description('停止本机托管服务或当前连接的 Runner；保留数据与会话').action(async () => {
        const value = await stop(context()); output(value, '本机服务已停止。数据与原生会话保留；服务停止期间无法通过此入口查看或审批。');
    });
    program.command('restart').description('应用新配置或安装版本，重启本机服务').action(async () => {
        const c = context(); await stop(c); const value = await start(c); output(value, summary(value));
    });
    program.command('serve').description('前台运行本机 Hub 与统一服务入口')
        .option('--public', '明确对外提供 Hub 服务；需配置 server.publicUrl')
        .action(async options => { await serve(context(), Boolean(options.public)); });
    program.command('doctor').description('检查配置、服务、HAPI 兼容性和认证；不运行模型').action(async () => {
        const value = await doctor(context());
        output(value, `${value.mode} · ${value.url}\n${value.checks.map(check => `${check.ok ? '✓' : '✗'} ${check.name}: ${typeof check.detail === 'string' ? check.detail : JSON.stringify(check.detail)}`).join('\n')}\n数据目录：${value.dataRoot}\n任务工作区数量仅统计当前连接在本机保留的 checkout 目录，详情用 task list / show 查看。\n模型登录与执行：尚未检查`
            + (value.ignoredEnvironment.length ? `\n连接设置由 Runweft 管理，未沿用：${value.ignoredEnvironment.join(', ')}` : ''));
        if (!value.ok) process.exitCode = 1;
    });

    const runner = program.command('runner').description('使用独立机器凭据运行当前 Hub 连接的本机 Runner');
    runner.command('start').action(async () => { const result = await startRunner(context()); output(result, JSON.stringify(result, null, 2)); });
    runner.command('stop').action(async () => { const result = await stopRunner(context()); output(result, '本机 Runner 已停止；数据保留。'); });
    runner.command('status').action(async () => { const result = await runnerStatus(context()); output(result, JSON.stringify(result, null, 2)); });
    const auth = program.command('auth').description('Hub 身份连接；凭据经 Web 加密交接');
    auth.command('status').action(async () => {
        const result = await new HubClient(hubOptions(context()), 'hubAccess', 'hub_access_unavailable').connection();
        output(result, JSON.stringify(result, null, 2));
    });
    auth.command('login').description('生成 Web 身份确认链接；确认后运行 hub connect complete').action(async () => {
        const c = context(), result = await new IdentityConnection(c.home, hubOptions(c).url).begin();
        output(result, `请打开并核对：${result.confirmationUrl}\n核对码：${result.code}\n确认后执行 hub connect complete。`);
    });
    program.command('open').description('打开 Hub 后台入口，浏览器使用自身身份').option('--hapi', '打开 HAPI 原生会话界面')
        .option('--print', '只输出无秘密地址，交给用户浏览器打开').action(async options => {
        const c = context();
        if (c.config.mode === 'local') await start(c);
        const address = await browserAddress(c.config.hub.url ?? localUrl(c.config), Boolean(options.hapi));
        if (!options.print) {
            const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
            const code = await new Promise<number>((resolve, reject) => {
                const child = spawn(command, [address.url], { stdio: 'ignore' });
                child.once('error', () => reject(new RunweftError('browser_unavailable', '无法打开本机浏览器。', `请打开 ${address.url}`)));
                child.once('exit', code => resolve(code ?? 1));
            });
            if (code) throw new RunweftError('browser_unavailable', '浏览器未能打开。', `请打开 ${address.url}`);
        }
        output({ opened: !options.print, url: address.url }, address.url);
    });
    program.command('hapi [args...]').description('通过 Runweft 使用原有 HAPI 命令')
        .helpOption(false).allowUnknownOption().passThroughOptions().action(async (args: string[]) => {
            const c = context();
            if (args[0] === 'hub' || (c.config.mode === 'local' && serviceState(c) && args[0] === 'runner' && ['start', 'start-sync', 'stop'].includes(args[1]))) {
                throw new RunweftError('managed_service', '该操作会覆盖 Runweft 管理的 Hub/Runner。', '请使用 runweft start / stop / restart；前台部署使用 runweft serve。');
            }
            if (['runner', 'codex', 'claude'].includes(args[0] ?? '')) machineConnection(c);
            const result = await runHapi(c, args);
            if (result.signal) process.kill(process.pid, result.signal);
            else process.exitCode = result.code;
        });
}
