import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { expandPath } from '../../config';
import { HubError } from '../types';
import { HubAgentClient } from './client';
import { AccessMode, agentInput } from './types';

function definitionFile(path: string): unknown {
    try { const bytes = readFileSync(expandPath(path)); if (bytes.length > 65_536) throw new Error(); return JSON.parse(bytes.toString('utf8')); }
    catch { throw new HubError(400, 'agent_definition_file_invalid', '无法读取 Agent 定义 JSON。', '指定最多 64 KiB 的完整业务定义对象；文件只是本次输入，不是持续权威配置。'); }
}
export function addAgentCommands(hub: Command, output: (value: unknown, human: string) => void) {
    const client = () => new HubAgentClient(hub.opts());
    function show(c: HubAgentClient, result: object) { output({ connection: { hub: c.url, spaceId: c.spaceId }, ...result }, `Hub：${c.url}\n空间：${c.spaceId ?? '未选择'}\n${JSON.stringify(result, null, 2)}`); }
    function read(command: Command, action: (c: HubAgentClient, ...args: any[]) => Promise<object>) { command.action(async (...args) => { const c = client(); show(c, await action(c, ...args)); }); }
    const group = hub.command('agent').description('中心 Agent 定义、不可变版本、共享与管理员治理');
    read(group.command('create').requiredOption('--request-id <uuid>', '为本次创建生成并保存一个 UUID')
        .requiredOption('--file <json>', '完整 definition JSON；仅作为本次输入'), (c, opts) => c.create(opts.requestId, definitionFile(opts.file)));
    read(group.command('request <request-id>').description('查询本人原创建请求'), (c, id) => c.receipt(id));
    read(group.command('list').description('私有内容仅所有者可见；非所有者管理员只见治理摘要'), c => c.list());
    read(group.command('show <id>'), (c, id) => c.agent(id));
    read(group.command('update <id>').requiredOption('--expected-version <number>', '读取到的当前整数版本')
        .requiredOption('--file <json>', '更新后的完整 definition JSON'), (c, id, opts) => c.update(id, Number(opts.expectedVersion), definitionFile(opts.file)));
    read(group.command('register <id>'), (c, id) => c.register(id, true));
    read(group.command('unregister <id>'), (c, id) => c.register(id, false));
    read(group.command('access <id> <mode>').description('所有者设置 private、members 或 space；分享不授予编辑权')
        .option('--member <id...>', 'members 模式下的当前成员 UUID'), (c, id, mode, opts) => c.access(id, agentInput(AccessMode, mode), opts.member ?? []));
    read(group.command('block <id>').description('管理员禁用；不改写或取得私有内容'), (c, id) => c.block(id, true));
    read(group.command('unblock <id>'), (c, id) => c.block(id, false));
    read(group.command('versions <id>').description('仅所有者可读完整历史版本'), (c, id) => c.versions(id));
}
