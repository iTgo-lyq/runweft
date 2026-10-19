import type { Command } from 'commander';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { atomicWrite } from '../../config';
import { RunweftError } from '../../errors';
import { HubClient, type HubConnectionOptions } from '../client';
import { readIdentityConnection } from '../connect/record';
import { connectionFileLock, hubConnectionPaths } from '../resources/connection';
import { terminalInput } from '../accounts/terminal';
import { InvitationToken } from '../types';

/** Identity-level APIs deliberately avoid a space JWT, so a removed default can be repaired. */
export function addSpaceCommands(program: Command, options: () => HubConnectionOptions, home: () => string,
    output: (value: unknown, human: string) => void) {
    const client = () => new HubClient(options(), 'hubIdentity', 'hub_identity_unavailable');
    const selected = (c: HubClient, id?: string) => {
        const value = id ?? c.spaceId;
        if (!value) throw new RunweftError('hub_space_required', '请选择空间。', '使用 space list 查询，再运行 space use <id> 或指定 --space。');
        return '/spaces/' + encodeURIComponent(value);
    };
    async function show(c: HubClient, result: object) {
        const value = { connection: { hub: c.url, ownerId: (await c.identity()).id, spaceId: c.spaceId }, ...result };
        output(value, JSON.stringify(value, null, 2));
    }
    function action(command: Command, run: (c: HubClient, ...args: any[]) => Promise<object>) {
        command.action(async (...args) => { const c = client(); await show(c, await run(c, ...args)); });
    }
    const space = program.command('space').description('空间、成员和邀请；复用中心权限规则');
    action(space.command('list').description('列出已加入空间；失效默认空间不阻塞查询'), c => c.user('/spaces'));
    action(space.command('show [id]'), (c, id) => c.user(selected(c, id)));
    action(space.command('create <name>').description('创建空间，不切换本机默认'), (c, name) => c.user('/spaces', 'POST', { name }));
    action(space.command('rename <id> <name>'), (c, id, name) => c.user(selected(c, id), 'PATCH', { name }));
    action(space.command('permissions [id]'), (c, id) => c.user(selected(c, id) + '/permissions'));
    space.command('use <id>').description('校验成员资格并保存本机默认；已有任务与 MCP 上下文保持原空间').action(async id => {
        const c = client(), paths = hubConnectionPaths(home(), c.url), before = readIdentityConnection(home(), c.url);
        if (!before) throw new RunweftError('hub_identity_missing', '请先登录并连接此 Hub。');
        const result = await c.user(selected(c, id));
        connectionFileLock(paths, () => {
            const current = readIdentityConnection(home(), c.url);
            if (JSON.stringify(current) !== JSON.stringify(before)) throw new RunweftError('hub_connection_changed', '本机连接已改变，未覆盖较新的选择。', '查询 space list 后重试。');
            atomicWrite(paths.identityConnection, JSON.stringify({ ...current, spaceId: result.space.id }, null, 2) + '\n');
        });
        output({ hub: c.url, ownerId: before.ownerId, space: result.space }, `默认空间：${result.space.name} (${result.space.id})`);
    });
    action(space.command('leave [id]').description('退出空间；最后一个 owner 须先转交所有权'), async (c, id) =>
        c.user(selected(c, id) + '/members/' + (await c.identity()).id, 'DELETE'));
    const member = space.command('member').description('管理当前选定空间的成员');
    action(member.command('list'), c => c.user(selected(c) + '/members'));
    action(member.command('set-role <user-id> <role>').description('角色：owner、admin、member'), (c, id, role) =>
        c.user(selected(c) + '/members/' + encodeURIComponent(id), 'PATCH', { role }));
    action(member.command('remove <user-id>'), (c, id) => c.user(selected(c) + '/members/' + encodeURIComponent(id), 'DELETE'));
    const invitation = space.command('invitation').description('邀请通过文件交付，不向对话输出秘密');
    action(invitation.command('list'), c => c.user(selected(c) + '/invitations'));
    action(invitation.command('revoke <id>'), (c, id) => c.user(selected(c) + '/invitations/' + encodeURIComponent(id), 'DELETE'));
    action(invitation.command('create').option('--role <role>', '邀请角色：admin 或 member', 'member')
        .requiredOption('--output <file>', '保存邀请到新的 0600 文件，不覆盖已有文件'), async (c, args) => {
        const fd = openSync(args.output, 'wx', 0o600);
        try {
            const result = await c.user(selected(c) + '/invitations', 'POST', { role: args.role });
            writeFileSync(fd, InvitationToken.parse(result.token) + '\n');
            return { invitation: result.invitation, file: args.output };
        } finally { closeSync(fd); }
    });
    action(invitation.command('accept').option('--file <file>', '读取获交付的邀请文件；省略时人工隐藏输入')
        .description('加入邀请空间，不切换本机默认'), async (c, args) => {
        const raw = args.file ? readFileSync(args.file, 'utf8').trim() : await terminalInput('邀请', true);
        const token = InvitationToken.safeParse(raw);
        if (!token.success) throw new RunweftError('hub_invitation_invalid', '邀请格式无效。');
        return c.user('/invitations/accept', 'POST', { token: token.data });
    });
}
