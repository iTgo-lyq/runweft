import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { atomicWrite, dataPaths, targetUrl, type ResolvedConfig } from './config';
import { accessToken, HapiClient, hapiClient, readSettings, runHapi } from './hapi';
import { RunweftError } from './errors';
import { doctor, requireRunweft, serve, serviceState, start, status, stop } from './services';

type Output = (value: unknown, human: string) => void;

export async function browserAddress(target: string, token: string, native = false) {
    if (!native && (await requireRunweft(target)).capabilities?.dashboard !== 1) {
        throw new RunweftError('dashboard_unavailable', '当前 Hub 尚未提供 Runweft 看板。', '更新 Hub 端并运行 runweft restart；也可使用 runweft open --hapi 打开原有界面。');
    }
    await new HapiClient(target, token).authenticate();
    const url = new URL(native ? '/' : '/runweft/', target);
    if (native) url.searchParams.set('hub', new URL(target).origin);
    const publicUrl = url.toString(); url.searchParams.set('token', token);
    return { url: url.toString(), publicUrl };
}

function summary(value: Awaited<ReturnType<typeof status>>) {
    return `${value.role} · ${value.running ? '已运行' : '未运行'} · ${value.url}\n`
        + (value.running ? `Runner：${value.runner ? '在线' : '未在线'} · namespace：${value.namespace} · 版本：${value.version}\n` : '')
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

    const auth = program.command('auth').description('使用当前 HAPI 连接的认证');
    auth.command('status').description('验证当前连接的访问令牌；不显示秘密').action(async () => {
        const c = context(); const identity = await hapiClient(c).authenticate();
        output({ authenticated: true, url: targetUrl(c.config), ...identity }, `认证有效：${targetUrl(c.config)}\nnamespace：${identity.namespace}`);
    });
    auth.command('login').description('保存并验证 Hub 令牌；本地模式自动沿用托管令牌')
        .option('--token-stdin', '从标准输入读取令牌，验证后保存到当前连接')
        .action(async options => {
            const c = context();
            if (c.config.mode === 'local') await start(c);
            else if (options.tokenStdin) {
                const token = (await Bun.stdin.text()).trim();
                if (!token) throw new RunweftError('empty_token', '标准输入中没有令牌。');
                await new HapiClient(targetUrl(c.config), token).authenticate();
                const home = dataPaths(c).hapiClient;
                atomicWrite(join(home, 'settings.json'), JSON.stringify({ ...readSettings(home), cliApiToken: token }, null, 2));
            } else if (!c.env[c.config.hub.tokenEnv]) {
                if (!process.stdin.isTTY) throw new RunweftError('interactive_login_required', '当前没有可交互终端。', `设置 ${c.config.hub.tokenEnv}，或通过 runweft auth login --token-stdin 传入令牌。`);
                const result = await runHapi(c, ['auth', 'login']);
                if (result.code) throw new RunweftError('login_failed', 'HAPI 登录未完成。');
            }
            const identity = await hapiClient(c).authenticate();
            output({ authenticated: true, url: targetUrl(c.config), ...identity }, `已连接：${targetUrl(c.config)}\nnamespace：${identity.namespace}`);
        });
    auth.command('token').description('仅在终端显式显示当前访问令牌').action(() => {
        if (!process.stdout.isTTY || program.opts().json) throw new RunweftError('terminal_required', '访问令牌只在交互终端中显示，不写入 JSON 或管道。');
        console.log(accessToken(context()));
    });
    program.command('open').description('使用当前登录打开协作看板').option('--hapi', '直接打开 HAPI 会话界面').action(async options => {
        const c = context();
        if (c.config.mode === 'local') await start(c);
        const address = await browserAddress(targetUrl(c.config), accessToken(c), Boolean(options.hapi));
        const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const code = await new Promise<number>((resolve, reject) => {
            const child = spawn(command, [address.url], { stdio: 'ignore' });
            child.once('error', () => reject(new RunweftError('browser_unavailable', '无法打开本机浏览器。', '在本机终端运行 runweft auth token，再手动登录服务地址。')));
            child.once('exit', code => resolve(code ?? 1));
        });
        if (code) throw new RunweftError('browser_unavailable', '浏览器未能打开。', '可在本机终端运行 runweft auth token，再手动登录服务地址。');
        output({ opened: true, url: address.publicUrl }, `已打开 ${address.publicUrl}`);
    });
    program.command('hapi [args...]').description('通过 Runweft 使用原有 HAPI 命令')
        .helpOption(false).allowUnknownOption().passThroughOptions().action(async (args: string[]) => {
            const c = context();
            if (args[0] === 'hub' || (c.config.mode === 'local' && serviceState(c) && args[0] === 'runner' && ['start', 'start-sync', 'stop'].includes(args[1]))) {
                throw new RunweftError('managed_service', '该操作会覆盖 Runweft 管理的 Hub/Runner。', '请使用 runweft start / stop / restart；前台部署使用 runweft serve。');
            }
            const result = await runHapi(c, args);
            if (result.signal) process.kill(process.pid, result.signal);
            else process.exitCode = result.code;
        });
}
