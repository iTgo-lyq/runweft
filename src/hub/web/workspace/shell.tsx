import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react';
import {
    AccountChip, AppFrame, Avatar, Banner, Button, Crumbs, Dialog, Form, Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator,
    NavButton, NavItem, NavLabel, Sidebar, SpaceSwitch, TextField, Toolbar, toast, useConfirm, useFindShortcut, type IconName,
} from '@runweft/ui';
import { HubApiError } from '../api/http';
import { roleLabels } from '../api/hub';
import type { View } from '../route';
import { useWorkspace } from './context';

export const pages: Record<View, { label: string; icon: IconName; group?: string }> = {
    tasks: { label: '任务', icon: 'tasks', group: '工作' },
    machines: { label: '机器', icon: 'machine', group: '执行资源' },
    runtimes: { label: 'Runtime', icon: 'runtime', group: '执行资源' },
    agents: { label: 'Agent', icon: 'agent', group: '执行资源' },
    repositories: { label: '仓库', icon: 'repo', group: '空间' },
    selections: { label: '我的选择', icon: 'sliders', group: '空间' },
    members: { label: '成员', icon: 'users', group: '空间' },
    settings: { label: '账号设置', icon: 'account' },
};

export function onboardingText(kind: 'hub' | 'machine') {
    return `请按 Runweft 产品 Skill 帮我接入 ${location.origin} 并完成一次只读评审体验。先检查已有安装和连接；没有有效连接时给我浏览器注册/登录授权链接，再用 complete --wait 60 继续。密码由我在自己的界面输入。通过 CLI 复用或准备机器、Runtime、当前仓库关联和私有评审 Agent，发起任务并读回完整报告；保留其他 MCP 与原生配置，MCP 重载及实际可用性单独报告。${kind === 'machine' ? '这次要接入的是当前这台机器。' : ''}`;
}

export function OnboardingDialog({ kind, open, onOpenChange }: { kind: 'hub' | 'machine'; open: boolean; onOpenChange(open: boolean): void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={kind === 'machine' ? '接入新机器' : '让 Agent 帮你接入'}
            description={kind === 'machine' ? '在要接入的那台机器上，把下面的说明交给 Codex 或 Claude Code。机器登记和凭据都在那台机器上完成，浏览器里不需要操作。' : '把下面的说明交给 Codex 或 Claude Code。密码由你在自己的终端或浏览器里输入，不要发给模型。'}
            footer={<CopyButton text={onboardingText(kind)} onDone={() => onOpenChange(false)} />}>
            <pre className="prompt" tabIndex={0}>{onboardingText(kind)}</pre>
        </Dialog>
    );
}

/** Copies when the browser allows it; otherwise selects the text (`source`, else the dialog's) so it can be copied by hand. */
export function CopyButton({ text, label = '复制说明', onDone, source }: { text: string; label?: string; onDone?: () => void; source?: RefObject<HTMLElement | null> }) {
    const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
    const copy = async () => {
        try {
            if (!navigator.clipboard) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            setState('copied'); toast('已复制');
        } catch {
            const node = source?.current ?? document.querySelector<HTMLElement>('.dialog .prompt, .dialog .secret-value');
            if (node) { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
            setState('manual');
        }
    };
    return (
        <>
            {state === 'manual' && <span className="hint" role="status">当前浏览器无法自动复制，已选中文本，请手动复制。</span>}
            {onDone && <Button onClick={onDone}>完成</Button>}
            <Button variant="primary" icon={state === 'copied' ? 'check' : 'file'} onClick={copy}>{state === 'copied' ? '已复制' : label}</Button>
        </>
    );
}

function FormDialog({ open, onOpenChange, title, description, submitLabel, children, onSubmit }: {
    open: boolean; onOpenChange(open: boolean): void; title: string; description: string; submitLabel: string; children: ReactNode; onSubmit(): Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const formId = `form-${title}`;
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form={formId} variant="primary" disabled={busy}>{submitLabel}</Button></>}>
            <Form id={formId} onSubmit={async () => { setBusy(true); try { await onSubmit(); } finally { setBusy(false); } }}>{children}</Form>
        </Dialog>
    );
}

function SpaceMenu() {
    const ws = useWorkspace();
    const [creating, setCreating] = useState(false);
    const [joining, setJoining] = useState(false);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [joinError, setJoinError] = useState<HubApiError | null>(null);
    return (
        <>
            <Menu label="切换空间" trigger={<SpaceSwitch name={ws.space.name} detail={`${roleLabels[ws.role]} · 切换空间`} />}>
                <MenuLabel>我的空间</MenuLabel>
                <MenuRadioGroup value={ws.space.id} onValueChange={id => { if (id !== ws.space.id) ws.switchSpace(id); }}>
                    {ws.spaces.map(space => <MenuRadioItem key={space.id} value={space.id} icon="space" description={roleLabels[space.role]} checked={space.id === ws.space.id}>{space.name}</MenuRadioItem>)}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem icon="plus" onSelect={() => { setName(''); setCreating(true); }}>创建空间…</MenuItem>
                <MenuItem icon="link" onSelect={() => { setToken(''); setJoinError(null); setJoining(true); }}>接受邀请…</MenuItem>
            </Menu>
            <FormDialog open={creating} onOpenChange={setCreating} title="创建空间" description="你会成为这个空间的所有者，之后可以邀请成员。" submitLabel="创建空间"
                onSubmit={async () => {
                    const space = await ws.run(() => ws.identityApi.createSpace(name.trim()), { success: `空间“${name.trim()}”已创建` });
                    if (!space) return;
                    setCreating(false); await ws.reloadIdentity({ spaceId: space.id });
                }}>
                <TextField label="空间名称" required maxLength={80} placeholder="例如：设计评审" value={name} onChange={event => setName(event.target.value)} />
            </FormDialog>
            <FormDialog open={joining} onOpenChange={setJoining} title="接受空间邀请" description="粘贴成员发给你的邀请。加入后的角色由邀请决定。" submitLabel="加入空间"
                onSubmit={async () => {
                    const space = await ws.run(() => ws.identityApi.acceptInvitation(token.trim()), { success: '已加入空间', onError: setJoinError });
                    if (!space) return;
                    setJoining(false); await ws.reloadIdentity({ spaceId: space.id });
                }}>
                <TextField label="邀请" required mono spellCheck={false} autoComplete="off" placeholder="rw_inv_…" value={token} onChange={event => setToken(event.target.value)} hint="邀请 24 小时内有效，只能由一人使用。" />
                {joinError && <Banner tone="danger" title={joinError.message}>{joinError.hint || undefined}</Banner>}
            </FormDialog>
        </>
    );
}

function AccountMenu() {
    const ws = useWorkspace();
    const confirm = useConfirm();
    return (
        <Menu label="账号菜单" trigger={<AccountChip name={ws.identity.name} username={ws.username} />}>
            <div className="menu-profile"><Avatar name={ws.identity.name} size="lg" /><div><strong>{ws.identity.name}</strong><span className="mono">{ws.username}</span></div></div>
            <MenuSeparator />
            <MenuItem icon="account" description="显示名称、登录环境和密码" onSelect={() => ws.navigate('settings')}>账号设置</MenuItem>
            <MenuItem icon="logout" onSelect={async () => {
                if (!await confirm('当前标签页会退出登录。已连接的命令行环境不受影响，已接受的任务会继续执行。', { title: '退出此浏览器？', confirmLabel: '退出' })) return;
                await ws.endSession(api => api.logout(), { tone: 'info', title: '已退出当前浏览器', text: '可以用账号密码重新登录。' });
            }}>退出此浏览器</MenuItem>
        </Menu>
    );
}

export function WorkspaceShell({ alert, onboarding, onOnboardingChange, children }: {
    alert: ReactNode; onboarding: 'hub' | 'machine' | null; onOnboardingChange(kind: 'hub' | 'machine' | null): void; children: ReactNode;
}) {
    const ws = useWorkspace();
    const [nav, setNav] = useState(false);
    const closeNav = useCallback(() => setNav(false), []);
    useFindShortcut();
    useEffect(() => { document.title = `${pages[ws.view].label} · ${ws.space.name} · Runweft Hub`; }, [ws.view, ws.space.name]);
    const groups: [string, View[]][] = [];
    for (const [view, spec] of Object.entries(pages) as [View, typeof pages[View]][]) {
        if (!spec.group) continue;
        const last = groups.at(-1);
        if (last?.[0] === spec.group) last[1].push(view); else groups.push([spec.group, [view]]);
    }
    return (
        <AppFrame navOpen={nav} onNavOpenChange={setNav}
            sidebar={
                <Sidebar onClose={closeNav} top={<SpaceMenu />}
                    foot={<><NavButton icon="link" onClick={() => ws.showOnboarding('hub')}>接入新环境</NavButton><AccountMenu /></>}>
                    {groups.map(([group, views]) => (
                        <div key={group} role="group" aria-label={group}>
                            <NavLabel>{group}</NavLabel>
                            {views.map(view => <NavItem key={view} icon={pages[view].icon} current={ws.view === view} href={`#view=${view}`} onSelect={() => { setNav(false); ws.navigate(view); }}>{pages[view].label}</NavItem>)}
                        </div>
                    ))}
                </Sidebar>
            }
            toolbar={<Toolbar onOpenNav={() => setNav(true)} crumbs={<Crumbs space={ws.space.name} page={pages[ws.view].label} />} actions={<Button icon="refresh" iconOnly label="刷新" variant="ghost" onClick={ws.refresh} />} />}>
            <div className="page-alert" id="page-alert">{alert}</div>
            {children}
            <OnboardingDialog kind={onboarding ?? 'hub'} open={!!onboarding} onOpenChange={open => { if (!open) onOnboardingChange(null); }} />
        </AppFrame>
    );
}
