import type { Command } from 'commander';
import type { ResolvedConfig } from '../config';
import { ResourceClient } from './client';
import { FlavorSchema, NameSchema, invalidInput, type Eligibility, type Inspection, type MachineView, type RuntimeView } from './types';

function selection(value: Eligibility) {
    return value.eligible ? '可选' : `不可选：${value.reason!.message}${value.reason!.hint ? `\n  下一步：${value.reason!.hint}` : ''}`;
}
function machineText(machine: MachineView) {
    return `${machine.name}\n  ID：${machine.id}\n  登记：${machine.registered ? '已登记' : '未登记'} · Runner：${machine.online ? '在线' : '离线'} · 平台：${machine.platform ?? '未知'}\n  执行机器：${selection(machine.eligibility)}`;
}
function inspectionText(value: Inspection | null, current: boolean) {
    if (!value) return '工具：尚未探测';
    const { executable, version, versionStatus, checkedAt } = value.details;
    const versions = { detected: version, not_found: '未发现命令', unrecognized: '无法识别', failed: '读取失败', timeout: '查询超时' };
    return `工具：${executable ? `已发现 ${executable}` : '未发现'} · 版本：${versions[versionStatus]}`
        + `\n  ${current ? '本次观察' : '历史观察（不能证明当前可用）'}：${new Date(checkedAt).toISOString()}`
        + (!value.available ? `\n  HAPI 启动检查未通过：${value.reason ?? '未发现工具'}` : '');
}
function runtimeText(runtime: RuntimeView) {
    return `${runtime.name}\n  ID：${runtime.id}\n  目标：${runtime.machine?.name ?? '未知机器'} · ${runtime.machineId} · ${runtime.flavor}`
        + `\n  登记：${runtime.registered ? '已登记' : '已取消'} · Runner：${runtime.machine?.online ? '在线' : '离线或不存在'}`
        + `\n  ${inspectionText(runtime.inspection, runtime.inspectionCurrent)}\n  新委派目标：${selection(runtime.eligibility)}`;
}
function name(value: string | undefined) {
    if (value === undefined) return undefined;
    const parsed = NameSchema.safeParse(value);
    if (!parsed.success) throw invalidInput('展示名称无效。');
    return parsed.data;
}
const unchecked = '模型认证与任务执行：未检查。';
const references = '已有任务继续使用原目标；已有 agent 引用需恢复登记或显式重新选择，不会自动改写。';

export function addResourceCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void) {
    function show(client: ResourceClient, value: { namespace: string }, human: string) {
        const connection = client.connection;
        output({ connection, ...value }, `连接：${connection.mode} · ${connection.url}\nnamespace：${value.namespace}\n${human}`);
    }
    const machines = program.command('machine').description('全局执行机器登记；与 Runner 启停、runtime 和 agent 分开');
    machines.command('register [id]').description('登记本机或已知机器；不会启动服务')
        .option('--name <name>', '展示名称；沿 HAPI 机器名称保存')
        .action(async (id, options) => {
            const displayName = name(options.name);
            const client = new ResourceClient(context()); const result = await client.registerMachine(id, displayName);
            show(client, result, `已登记机器：\n${machineText(result.machine)}\n下一步：runweft runtime discover --machine ${result.machine.id}`);
        });
    machines.command('list').description('列出已登记机器及当前连接的本机')
        .option('--all', '包含未登记和离线历史机器')
        .action(async options => {
            const client = new ResourceClient(context()); const result = await client.machines(Boolean(options.all));
            show(client, result, result.machines.length ? `${result.machines.map(machineText).join('\n\n')}\n执行任务还需选择已登记的 runtime。`
                : '尚无机器。先运行 runweft start，再运行 runweft machine register；查看历史用 runweft machine list --all。');
        });
    machines.command('show [id]').description('查看机器；默认当前连接的本机').action(async id => {
        const client = new ResourceClient(context()); const result = await client.machine(id);
        show(client, result, `${machineText(result.machine)}\n执行任务还需选择已登记的 runtime。`);
    });
    machines.command('rename <id> <name>').description('修改展示名称；保留机器与 runtime 身份').action(async (id, value) => {
        const displayName = name(value)!;
        const client = new ResourceClient(context()); const result = await client.renameMachine(id, displayName);
        show(client, result, `已更新机器名称：\n${machineText(result.machine)}`);
    });
    machines.command('unregister <id>').description('取消机器登记；保留其 runtime 登记和原生任务').action(async id => {
        const client = new ResourceClient(context()); const result = await client.unregisterMachine(id);
        show(client, result, `已取消机器登记：${result.machine.name} · ${result.machine.id}\n受影响的 runtime：${result.affectedRuntimeIds.length ? result.affectedRuntimeIds.join(', ') : '无'}\n${references}`);
    });

    const runtimes = program.command('runtime').description('全局 Codex/Claude Code 执行资源；agent 通过 ID 引用');
    runtimes.command('discover').description('发现实际命令及版本；不会登记资源或运行模型')
        .option('--machine <id>', '目标机器；默认当前连接的本机')
        .action(async options => {
            const client = new ResourceClient(context()); const result = await client.discover(options.machine);
            show(client, result, `${machineText(result.machine)}\n\n${result.tools.map(tool => `${tool.flavor}\n  ${inspectionText(tool.inspection, true)}${tool.problem ? `\n  ${tool.problem.message}\n  ${tool.problem.hint ?? ''}` : ''}`).join('\n\n')}\n${unchecked}\n登记：runweft machine register ${result.machine.id}，然后 runweft runtime register <codex|claude> --machine ${result.machine.id}`);
        });
    runtimes.command('register <flavor>').description('登记 codex 或 claude；要求机器已登记且工具可发现')
        .option('--machine <id>', '目标机器；默认当前连接的本机')
        .option('--name <name>', '可修改的展示名称；身份使用返回的 ID')
        .action(async (flavor, options) => {
            const parsed = FlavorSchema.safeParse(flavor);
            if (!parsed.success) throw invalidInput('runtime 类型只支持 codex 或 claude。');
            const displayName = name(options.name);
            const client = new ResourceClient(context()); const result = await client.registerRuntime(parsed.data, options.machine, displayName);
            show(client, result, `已登记 runtime：\n${runtimeText(result.runtime)}\n${unchecked}\n后续 agent 定义引用 ID：${result.runtime.id}`);
        });
    runtimes.command('list').description('列出已登记 runtime，并查询实际工具')
        .option('--all', '包含已取消登记的 runtime')
        .action(async options => {
            const client = new ResourceClient(context()); const result = await client.runtimes(Boolean(options.all));
            show(client, result, result.runtimes.length ? `${result.runtimes.map(runtimeText).join('\n\n')}\n${unchecked}`
                : '尚无 runtime。运行 runweft machine register、runweft runtime discover，再登记所需的 codex 或 claude：runweft runtime register codex。');
        });
    for (const command of ['show', 'check'] as const) {
        runtimes.command(`${command} <id>`).description(command === 'check' ? '检查新任务目标资格；不可选时退出码为 1' : '查看登记、原生详情及不可用原因')
            .action(async id => {
                const client = new ResourceClient(context()); const result = await client.runtime(id, command === 'check');
                show(client, result, `${runtimeText(result.runtime)}\n${unchecked}`);
                if (command === 'check' && !result.runtime.eligibility.eligible) process.exitCode = 1;
            });
    }
    runtimes.command('rename <id> <name>').description('只修改 runtime 展示名称；不能改绑机器或类型').action(async (id, value) => {
        const displayName = name(value)!;
        const client = new ResourceClient(context()); const result = await client.renameRuntime(id, displayName);
        show(client, result, `已更新 runtime 名称：${result.runtime.name}\nID：${result.runtime.id}\n目标：${result.runtime.machineId} · ${result.runtime.flavor}`);
    });
    runtimes.command('unregister <id>').description('取消 runtime 登记；保留历史身份和原生任务').action(async id => {
        const client = new ResourceClient(context()); const result = await client.unregisterRuntime(id);
        show(client, result, `已取消 runtime 登记：${result.runtime.name} · ${result.runtime.id}\n${references}`);
    });
}
