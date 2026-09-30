import type { Command } from 'commander';
import { addRepositoryCommands } from '../repositories/commands';
import { dirname } from 'node:path';
import { configPath } from '../../config';
import { FlavorSchema, invalidInput } from '../../resources/types';
import { HubResourceClient } from './client';
import { hubConnectionPaths, MachineConnection } from './connection';

export function addHubCommands(program: Command, output: (value: unknown, human: string) => void) {
    const hub = program.command('hub').description('通过明确 Hub 身份管理中心资源；不会启动本地服务')
        .requiredOption('--url <origin>', 'Hub HTTP(S) 根地址')
        .option('--identity-file <file>', 'Web 身份备份或只含身份 token 的文件；默认 RUNWEFT_IDENTITY_TOKEN')
        .option('--space <id>', '当前空间 UUID；使用 runtime 和空间治理时需要');
    addRepositoryCommands(hub, output);
    const client = () => new HubResourceClient(hub.opts());
    const home = () => dirname(configPath(program.opts().home));
    function show(connection: HubResourceClient, result: object, message?: string) {
        const value = { connection: { hub: connection.url, spaceId: connection.spaceId }, ...result };
        output(value, `Hub：${connection.url}${connection.spaceId ? `\n空间：${connection.spaceId}` : ''}\n${message ?? JSON.stringify(result, null, 2)}`);
    }
    function read(command: Command, action: (c: HubResourceClient, ...args: any[]) => Promise<object>) {
        command.action(async (...args) => { const c = client(); show(c, await action(c, ...args)); });
    }
    hub.command('paths').description('显示该 Hub 的本机持久接入目录；无需读取 token').action(() => {
        const paths = hubConnectionPaths(home(), hub.opts().url);
        output(paths, `Hub：${paths.hub}\n机器接入凭据：${paths.machineConnection}\n本机协调数据库：${paths.clientState}\n原生 Runner 数据：${paths.connection}/hapi`);
    });
    read(hub.command('identity').description('确认当前身份，不输出 token'), async c => ({ identity: await c.identity() }));
    const machine = hub.command('machine').description('机器登记、空间关联与本机接入凭据');
    machine.command('enroll').description('保存本机凭据并接入 Hub；重跑恢复同一接入请求')
        .option('--name <name>', '首次接入的展示名称')
        .action(async options => {
            const c = client(), result = await new MachineConnection(home(), c).enroll(options.name);
            show(c, result, `机器：${result.machineId}\n凭据文件：${result.credentialFile}\n凭据 ID：${result.credentialId}\n原生 Runner 使用该文件中的机器 ID 和凭据连接此 Hub。${result.runnerRestartRequired ? '\n凭据已替换，请重新启动 Runner。' : ''}`);
        });
    machine.command('rotate-credential').description('替换本机机器凭据；中断后重跑使用已保存的 pending 记录')
        .option('--replace-pending', '显式放弃已有 pending 凭据，按 Hub 当前凭据 ID 生成新的替换请求')
        .action(async options => {
            const c = client(), result = await new MachineConnection(home(), c).rotate(!!options.replacePending);
            show(c, result, `机器凭据已替换：${result.machineId}\n凭据文件：${result.credentialFile}\n请使用新凭据重新启动 Runner。`);
        });
    read(machine.command('enrollment <request-id>').description('查询原接入请求的非秘密结果'), (c, id) => c.enrollment(id));
    read(machine.command('list').description('列出可见机器，包括未连接与已注销的历史配置'), c => c.machines());
    read(machine.command('show <id>').description('查看机器与当前空间权限'), (c, id) => c.machine(id));
    read(machine.command('rename <id> <name>').description('修改机器名称，复用原生 HAPI 名称'), (c, id, name) => c.renameMachine(id, name));
    read(machine.command('register <id>').description('恢复已有机器的登记状态'), (c, id) => c.registerMachine(id, true));
    read(machine.command('unregister <id>').description('取消登记，保留凭据与原生历史'), (c, id) => c.registerMachine(id, false));
    read(machine.command('credential <id>').description('查询机器凭据 ID 和状态，不返回 token'), (c, id) => c.credential(id));
    read(machine.command('revoke-credential <id>').description('撤销机器连接凭据，保留登记配置'), (c, id) => c.revokeCredential(id));
    read(machine.command('associate <id> <space-id>').description('把机器关联空间；不自动分享 runtime'), (c, id, space) => c.associate(id, space, true));
    read(machine.command('detach <id> <space-id>').description('撤回关联及其在此空间的 runtime 分享'), (c, id, space) => c.associate(id, space, false));
    read(machine.command('discover <id>').description('所有者查看原生 Codex/Claude 工具，不启动模型'), (c, id) => c.discover(id));
    const runtime = hub.command('runtime').description('独立登记 Codex/Claude runtime，控制空间分享');
    runtime.command('register <flavor>').description('登记已接入机器上的工具；同机同类型保持一个 ID')
        .requiredOption('--machine <id>', '执行机器 ID').option('--name <name>', '展示名称')
        .action(async (flavor, options) => {
            const parsed = FlavorSchema.safeParse(flavor); if (!parsed.success) throw invalidInput('runtime 只支持 codex 或 claude。');
            const c = client(); show(c, await c.registerRuntime(options.machine, parsed.data, options.name));
        });
    read(runtime.command('list').description('列出可见 runtime 与当前可用性'), c => c.runtimes());
    read(runtime.command('show <id>').description('查看 runtime；完整工具详情仅所有者可见'), (c, id) => c.runtime(id));
    runtime.command('check <id>').description('检查当前执行目标；不可用时退出码 1').action(async id => {
        const c = client(), result = await c.runtime(id, true); show(c, result);
        if (!result.runtime.eligibility.eligible) process.exitCode = 1;
    });
    read(runtime.command('resolve <id>').description('解析当前空间固定执行目标'), (c, id) => c.resolve(id));
    read(runtime.command('rename <id> <name>').description('修改展示名称，保持机器与类型'), (c, id, name) => c.renameRuntime(id, name));
    read(runtime.command('unregister <id>').description('取消登记，保留稳定 ID'), (c, id) => c.unregisterRuntime(id));
    read(runtime.command('share <id> <space-id>').description('向指定空间成员授予执行使用权'), (c, id, space) => c.share(id, space, true));
    read(runtime.command('unshare <id> <space-id>').description('撤回该空间的使用授权'), (c, id, space) => c.share(id, space, false));
    for (const [group, kind] of [[machine, 'machine'], [runtime, 'runtime']] as const) {
        for (const blocked of [true, false]) read(group.command(`${blocked ? 'block' : 'unblock'} <id> <space-id>`)
            .description(`${blocked ? '禁用' : '解除禁用'}该空间中的资源；须为此空间管理员`), (c, id, space) => c.block(kind, id, space, blocked));
    }
}
