import type { HubConnectionOptions } from '../client';
import type { Command } from 'commander';
import { HubRepositoryClient } from './client';
import { observeRepository } from './observation';

export function addRepositoryCommands(hub: Command, output: (value: unknown, human: string) => void, options: () => HubConnectionOptions = () => hub.opts()) {
    const client = () => new HubRepositoryClient(options());
    function show(c: HubRepositoryClient, result: object) {
        output({ connection: { hub: c.url, spaceId: c.spaceId }, ...result }, `Hub：${c.url}\n空间：${c.spaceId ?? '未选择'}\n${JSON.stringify(result, null, 2)}`);
    }
    function read(command: Command, action: (c: HubRepositoryClient, ...args: any[]) => Promise<object>) {
        command.action(async (...args) => { const c = client(); show(c, await action(c, ...args)); });
    }
    const group = hub.command('repository').description('管理空间仓库与本人 checkout 关联；仓库地址不授予执行权限');
    read(group.command('create <name>').requiredOption('--request-id <uuid>', '为本次创建生成并保留一个 UUID；重复请求使用原 ID')
        .option('--alias <url...>', '明确的 Git remote 别名'), (c, name, opts) => c.create({ requestId: opts.requestId, name, aliases: opts.alias }));
    read(group.command('request <request-id>').description('查询本人原创建请求，返回当前记录'), (c, id) => c.receipt(id));
    read(group.command('list'), c => c.list());
    read(group.command('show <id>'), (c, id) => c.repository(id));
    read(group.command('rename <id> <name>'), (c, id, name) => c.rename(id, name));
    read(group.command('register <id>'), (c, id) => c.register(id, true));
    read(group.command('unregister <id>'), (c, id) => c.register(id, false));
    read(group.command('alias <id> <url>'), (c, id, url) => c.alias(id, url, true));
    read(group.command('un-alias <id> <url-or-key>').description('按原 URL 或目录返回的 canonicalKey 删除明确别名'), (c, id, url) => c.alias(id, url, false));
    read(group.command('checkouts').description('仅查看本人在当前空间的本机关联'), c => c.checkouts());
    group.command('inspect').description('只读本机 Git；输出已脱敏的观察，不需要身份 token').option('--cwd <directory>', '实际工作区目录', process.cwd())
        .action(opts => { const seen = observeRepository(opts.cwd); output({ observation: seen }, JSON.stringify(seen, null, 2)); });
    group.command('match').description('只读匹配；歧义或未关联时退出码 1').requiredOption('--machine <id>', '本人的 Hub 机器 ID')
        .option('--cwd <directory>', '实际工作区目录', process.cwd()).option('--remote <name>', '显式选择一个 fetch remote')
        .action(async opts => { const c = client(), result = await c.match(opts.machine, observeRepository(opts.cwd), opts.remote); show(c, result); if (result.status !== 'matched') process.exitCode = 1; });
    read(group.command('bind <id>').description('显式绑定当前 clone；所有 worktree 共享这一关联').requiredOption('--machine <id>', '本人的 Hub 机器 ID')
        .option('--cwd <directory>', '实际工作区目录', process.cwd()), (c, id, opts) => c.bind(opts.machine, observeRepository(opts.cwd), id));
    read(group.command('unbind').requiredOption('--machine <id>', '本人的 Hub 机器 ID').option('--cwd <directory>', '实际工作区目录', process.cwd()),
        (c, opts) => c.unbind(opts.machine, observeRepository(opts.cwd)));
}
