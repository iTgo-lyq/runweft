import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    AccountChip, AppFrame, Avatar, Banner, Button, ConfirmProvider, Crumbs, Dialog, Form, Icon, IconSprite, Menu, MenuItem, MenuLabel, MenuRadioGroup,
    MenuRadioItem, MenuSeparator, NavButton, NavItem, NavLabel, Popover, Segmented, Sidebar, SkipLink, SpaceSwitch, TextField, Toaster, Toolbar,
    clockTime, toast, useConfirm, useFindShortcut, type IconName,
} from '@runweft/ui';
import { HUB_ORIGIN, HubError, roleLabels } from './mock.js';
import { NOW } from './time.js';
import { ProtoContext, demo, routes, useProto, type Notice, type Proto, type Route } from './proto';
import { AccountPage, type Scene } from './pages/account';
import { TasksPage } from './pages/tasks';
import { MachinesPage, RuntimesPage } from './pages/resources';
import { AgentsPage } from './pages/agents';
import { RepositoriesPage } from './pages/repositories';
import { SelectionsPage } from './pages/selections';
import { MembersPage } from './pages/members';
import { SettingsPage } from './pages/settings';

const pages: Record<Route, { label: string; icon: IconName; group?: string; render: () => ReactNode }> = {
    tasks: { label: '任务', icon: 'tasks', group: '工作', render: () => <TasksPage /> },
    machines: { label: '机器', icon: 'machine', group: '执行资源', render: () => <MachinesPage /> },
    runtimes: { label: 'Runtime', icon: 'runtime', group: '执行资源', render: () => <RuntimesPage /> },
    agents: { label: 'Agent', icon: 'agent', group: '执行资源', render: () => <AgentsPage /> },
    repositories: { label: '仓库', icon: 'repo', group: '空间', render: () => <RepositoriesPage /> },
    selections: { label: '我的选择', icon: 'sliders', group: '空间', render: () => <SelectionsPage /> },
    members: { label: '成员', icon: 'users', group: '空间', render: () => <MembersPage /> },
    settings: { label: '账号设置', icon: 'account', render: () => <SettingsPage /> },
};
const scenarios = [
    { value: 'normal', label: '正常' }, { value: 'empty', label: '空数据' }, { value: 'error', label: '首次加载失败' },
    { value: 'refresh-error', label: '刷新失败' }, { value: 'offline', label: '离线或结果未知' }, { value: 'expired', label: '登录过期' },
];
const accountScenes = [
    { value: 'register', label: '首次注册并连接' }, { value: 'login', label: '已有账号（多个空间）' }, { value: 'expired-request', label: '连接请求过期' },
    { value: 'recover', label: '忘记密码' }, { value: 'settings', label: '账号设置' }, { value: 'first-run', label: '首次工作台' },
];
const onboardingText = `请按 Runweft 产品 Skill 帮我接入 ${HUB_ORIGIN} 并完成一次只读评审体验。先检查已有安装和连接；没有有效连接时给我浏览器注册/登录授权链接，再用 complete --wait 60 继续。密码由我在自己的界面输入。通过 CLI 复用或准备机器、Runtime、当前仓库关联和私有评审 Agent，发起任务并读回完整报告；保留其他 MCP 与原生配置，MCP 重载及实际可用性单独报告。`;

const entry = document.body.dataset.entry ?? 'tasks';
const initialRoute: Route | 'account' = entry === 'account-onboarding' ? 'account' : (routes as readonly string[]).includes(entry) ? entry as Route : 'tasks';
type Overlay = { kind: 'onboarding'; variant: 'hub' | 'machine' } | { kind: 'native'; detail: any; files: boolean } | null;

export function App({ onReady }: { onReady(): void }) {
    const [route, setRoute] = useState<Route | 'account'>(initialRoute);
    const [scene, setScene] = useState<Scene>('register');
    const [notice, setNotice] = useState<Notice | null>(null);
    const [returnTo, setReturnTo] = useState<Route | null>(null);
    const [alert, setAlert] = useState<HubError | null>(null);
    const [stale, setStale] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [generation, setGeneration] = useState(0);
    const [focusTick, setFocusTick] = useState(0);
    const [overlay, setOverlay] = useState<Overlay>(null);
    const [, setVersion] = useState(0);
    const changed = useCallback(() => setVersion(value => value + 1), []);
    const current = useRef(route);
    current.current = route;
    // Set by navigation and the "refresh failed" scenario; applied once the next page has loaded.
    const after = useRef({ focus: false, refresh: false });
    useEffect(() => { onReady(); }, [onReady]);

    const navigate = useCallback((next: Route | 'account', { focus = true } = {}) => {
        setAlert(null); setStale(false); setRoute(next);
        if (focus) after.current.focus = true;
        if (next === 'account') setFocusTick(value => value + 1);
    }, []);
    const expire = useCallback(() => {
        const target: Route = current.current === 'account' ? 'tasks' : current.current;
        demo.settings.scenario = 'normal';
        setReturnTo(target); setScene('signin');
        setNotice({ tone: 'warn', title: '登录已失效', text: `重新登录后回到“${pages[target].label}”。` });
        setAlert(null); setStale(false); setRoute('account'); setFocusTick(value => value + 1);
    }, []);
    const pageLoaded = useCallback(() => {
        if (after.current.refresh) { after.current.refresh = false; setRefreshTick(value => value + 1); }
        if (after.current.focus) { after.current.focus = false; requestAnimationFrame(() => document.querySelector<HTMLElement>('#page h1')?.focus()); }
    }, []);
    const showAlert = useCallback((error: HubError) => setAlert(error), []);
    const run = useCallback<Proto['run']>(async (action, { success, onError } = {}) => {
        try {
            const result = await action();
            if (success) toast(success);
            return result ?? true;
        } catch (error) {
            if (!(error instanceof HubError)) throw error;
            if (error.kind === 'expired') { expire(); return false; }
            if (onError) { onError(error); return false; }
            setAlert(error);
            return false;
        }
    }, [expire]);
    const signedOut = useCallback((next: Notice) => {
        setScene('signin'); setNotice(next); setAlert(null); setStale(false); setRoute('account'); setFocusTick(value => value + 1);
    }, []);
    const proto = useMemo<Proto>(() => ({
        signedOut,
        route: route === 'account' ? 'tasks' : route, refreshTick, navigate, run, showAlert, setStale, expire, changed, pageLoaded,
        refresh: () => setRefreshTick(value => value + 1),
        showOnboarding: (variant = 'hub') => setOverlay({ kind: 'onboarding', variant }),
        openNative: (detail, kind) => setOverlay({ kind: 'native', detail, files: kind === 'files' }),
    }), [route, refreshTick, navigate, run, showAlert, expire, changed, pageLoaded, signedOut]);

    // Account scenes: the demo resets the data when a scene starts, as the original prototype did.
    const account = {
        scene, notice,
        setScene(next: Scene, nextNotice: Notice | null = null) { setScene(next); setNotice(nextNotice); setFocusTick(value => value + 1); },
        signedIn(target?: Route) { const next = target ?? returnTo ?? 'tasks'; setReturnTo(null); setNotice(null); setGeneration(value => value + 1); navigate(next); },
    };

    const demoActions = {
        goScene: async (value: string) => {
            if (value === 'settings') { await demo.api.login('linzhou'); setGeneration(n => n + 1); navigate('settings'); return; }
            if (value === 'first-run') { await demo.api.register('demo-user'); setGeneration(n => n + 1); navigate('tasks'); return; }
            demo.reset(); setNotice(null); setScene(value as Scene); setRoute('account'); setGeneration(n => n + 1); setFocusTick(n => n + 1);
        },
        setScenario: (value: string) => {
            demo.settings.scenario = value; setAlert(null); changed();
            if (value === 'expired') { expire(); return; }
            if (value === 'refresh-error') after.current.refresh = true;
            setGeneration(n => n + 1);
        },
        setRole: (value: string) => { demo.settings.role = value; setAlert(null); setGeneration(n => n + 1); },
        reset: () => {
            demo.reset(); setRoute(initialRoute); setScene('register'); setNotice(null); setReturnTo(null); setAlert(null); setStale(false);
            setGeneration(n => n + 1); toast('演示已重置', 'info');
        },
    };

    useEffect(() => {
        if (!focusTick) return;
        requestAnimationFrame(() => document.querySelector<HTMLElement>('#page h1')?.focus());
    }, [focusTick]);

    let screen: ReactNode;
    if (route === 'account') screen = <AccountPage {...account} />;
    else {
        const space = demo.space(), spec = pages[route];
        const tone = alert?.kind === 'unknown' ? 'warn' : alert?.kind === 'unreachable' ? 'offline' : 'danger';
        screen = (
            <Workspace route={route} navigate={navigate} signedOut={signedOut} proto={proto}>
                <div className="page-alert" id="page-alert">
                    {alert && (
                        <Banner tone={tone} title={alert.message} actions={<>
                            {alert.kind === 'unknown' && <Button size="sm" icon="refresh" onClick={proto.refresh}>刷新核对</Button>}
                            <Button size="sm" icon="x" iconOnly label="关闭提示" variant="ghost" onClick={() => setAlert(null)} />
                        </>}>{alert.hint || undefined}</Banner>
                    )}
                    {!alert && stale && (
                        <Banner tone="offline" title="刷新失败：无法连接 Hub" actions={<Button size="sm" icon="refresh" onClick={proto.refresh}>重试</Button>}>
                            下面是 {clockTime(NOW)} 读取的内容，可能已经变化。你的账号和设置不会改变。
                        </Banner>
                    )}
                </div>
                <div key={`${generation}:${space.id}:${demo.settings.role}:${route}`} className="page-content">{spec.render()}</div>
            </Workspace>
        );
    }
    return (
        <ProtoContext.Provider value={proto}>
            <ConfirmProvider>
                <IconSprite /><SkipLink />
                {screen}
                <DemoControls route={route} scene={scene} actions={demoActions} />
                <Overlays overlay={overlay} onClose={() => setOverlay(null)} />
                <Toaster />
            </ConfirmProvider>
        </ProtoContext.Provider>
    );
}

function Workspace({ route, navigate, signedOut, proto, children }: { route: Route; navigate: Proto['navigate']; signedOut(notice: Notice): void; proto: Proto; children: ReactNode }) {
    const [nav, setNav] = useState(false);
    const closeNav = useCallback(() => setNav(false), []);
    useFindShortcut();
    const space = demo.space(), role = demo.role(), user = demo.user, spec = pages[route];
    useEffect(() => { document.title = `${spec.label} · ${space.name} · Runweft Hub`; }, [spec.label, space.name]);
    const groups: [string, Route[]][] = [];
    for (const [key, value] of Object.entries(pages) as [Route, typeof pages[Route]][]) {
        if (!value.group) continue;
        const last = groups.at(-1);
        if (last?.[0] === value.group) last[1].push(key); else groups.push([value.group, [key]]);
    }
    return (
        <AppFrame navOpen={nav} onNavOpenChange={setNav}
            sidebar={
                <Sidebar onClose={closeNav} top={<SpaceMenu role={role} />}
                    foot={<><NavButton icon="link" onClick={() => proto.showOnboarding()}>接入新环境</NavButton><AccountMenu user={user} navigate={navigate} signedOut={signedOut} /></>}>
                    {groups.map(([group, items]) => (
                        <div key={group} role="group" aria-label={group}>
                            <NavLabel>{group}</NavLabel>
                            {items.map(item => <NavItem key={item} icon={pages[item].icon} current={route === item} href={`#${item}`} onSelect={() => { setNav(false); navigate(item); }}>{pages[item].label}</NavItem>)}
                        </div>
                    ))}
                </Sidebar>
            }
            toolbar={<Toolbar onOpenNav={() => setNav(true)} crumbs={<Crumbs space={space.name} page={spec.label} />}
                actions={<Button icon="refresh" iconOnly label="刷新" variant="ghost" onClick={proto.refresh} />} />}>
            {children}
        </AppFrame>
    );
}

function SpaceMenu({ role }: { role: string }) {
    const proto = useProto();
    const [spaces, setSpaces] = useState<{ id: string; name: string; role: string }[] | null>(null);
    const [creating, setCreating] = useState(false);
    const [joining, setJoining] = useState(false);
    const space = demo.space();
    useEffect(() => { demo.api.spaces().then(setSpaces, () => setSpaces(null)); }, [space.id, space.name, role, proto.refreshTick]);
    const list = spaces ?? [{ ...space, role }];
    return (
        <>
            <Menu label="切换空间" trigger={<SpaceSwitch name={space.name} detail={`${roleLabels[role]} · 切换空间`} />}>
                <MenuLabel>我的空间</MenuLabel>
                <MenuRadioGroup value={space.id} onValueChange={id => {
                    if (id === space.id) return;
                    demo.settings.spaceId = id; proto.navigate(proto.route, { focus: false }); proto.changed();
                    toast(`已切换到“${list.find(item => item.id === id)?.name}”`);
                }}>
                    {list.map(item => <MenuRadioItem key={item.id} value={item.id} icon="space" description={roleLabels[item.role]} checked={item.id === space.id}>{item.name}</MenuRadioItem>)}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem icon="plus" onSelect={() => setCreating(true)}>创建空间…</MenuItem>
                <MenuItem icon="link" onSelect={() => setJoining(true)}>接受邀请…</MenuItem>
            </Menu>
            <SpaceDialog open={creating} onOpenChange={setCreating} kind="create" />
            <SpaceDialog open={joining} onOpenChange={setJoining} kind="join" />
        </>
    );
}

function SpaceDialog({ open, onOpenChange, kind }: { open: boolean; onOpenChange(open: boolean): void; kind: 'create' | 'join' }) {
    const proto = useProto();
    const [value, setValue] = useState('');
    const [error, setError] = useState<HubError | null>(null);
    useEffect(() => { if (open) { setValue(''); setError(null); } }, [open]);
    const create = kind === 'create';
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={create ? '创建空间' : '接受空间邀请'}
            description={create ? '你会成为这个空间的所有者，之后可以邀请成员。' : '粘贴成员发给你的邀请。加入后的角色由邀请决定。'}
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form={`space-${kind}`} variant="primary">{create ? '创建空间' : '加入空间'}</Button></>}>
            <Form id={`space-${kind}`} onSubmit={async () => {
                const space = await proto.run(() => create ? demo.api.createSpace(value.trim()) : demo.api.acceptInvitation(value), create ? {} : { onError: setError });
                if (!space || space === true) return;
                onOpenChange(false);
                demo.settings.spaceId = (space as any).id; proto.navigate(proto.route, { focus: false }); proto.changed();
                toast(create ? `空间“${(space as any).name}”已创建` : `已加入“${(space as any).name}”`);
            }}>
                {create
                    ? <TextField label="空间名称" required maxLength={80} placeholder="例如：设计评审" value={value} onChange={event => setValue(event.target.value)} />
                    : <TextField label="邀请" required mono spellCheck={false} placeholder="rw_inv_…" hint="演示中输入 demo。邀请 24 小时内有效，只能由一人使用。" value={value} onChange={event => setValue(event.target.value)} />}
                {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
            </Form>
        </Dialog>
    );
}

function AccountMenu({ user, navigate, signedOut }: { user: { name: string; username: string; hue: number }; navigate: Proto['navigate']; signedOut(notice: Notice): void }) {
    const confirm = useConfirm();
    return (
        <Menu label="账号菜单" trigger={<AccountChip name={user.name} username={user.username} hue={user.hue} />}>
            <div className="menu-profile"><Avatar name={user.name} hue={user.hue} size="lg" /><div><strong>{user.name}</strong><span className="mono">{user.username}</span></div></div>
            <MenuSeparator />
            <MenuItem icon="account" description="显示名称、登录环境和密码" onSelect={() => navigate('settings')}>账号设置</MenuItem>
            <MenuItem icon="logout" onSelect={async () => {
                if (!await confirm('当前标签页会退出登录。已连接的命令行环境不受影响，已接受的任务会继续执行。', { title: '退出此浏览器？', confirmLabel: '退出' })) return;
                signedOut({ tone: 'info', title: '已退出当前浏览器', text: '可以用账号密码重新登录。' });
            }}>退出此浏览器</MenuItem>
        </Menu>
    );
}

function Overlays({ overlay, onClose }: { overlay: Overlay; onClose(): void }) {
    const open = overlay !== null, onOpenChange = (next: boolean) => { if (!next) onClose(); };
    if (overlay?.kind === 'native') {
        const { detail, files } = overlay;
        return (
            <Dialog open={open} onOpenChange={onOpenChange} title={files ? '原生文件' : '原生会话'} description="实际产品会在新标签页打开这一轮的 HAPI 页面。"
                footer={<Button variant="primary" onClick={onClose}>知道了</Button>}>
                <div className="native-preview"><Icon name={files ? 'file' : 'external'} /><div>
                    <strong>{files ? `${detail.agent.name} · 第 ${detail.round} 轮的文件与差异` : `${detail.agent.name} · 第 ${detail.round} 轮的消息与审批`}</strong>
                    <span className="mono">{detail.native.session_id}</span>
                </div></div>
                <p className="hint">新标签页只获得当前账号和空间的限时访问，不会取得机器的 shell。过期后回到这里重新打开。审批、消息和文件都在 HAPI 页面里处理。</p>
            </Dialog>
        );
    }
    const machine = overlay?.kind === 'onboarding' && overlay.variant === 'machine';
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={machine ? '接入新机器' : '让 Agent 帮你接入'}
            description={machine ? '在要接入的那台机器上，把下面的说明交给 Codex 或 Claude Code。机器登记和凭据都在那台机器上完成，浏览器里不需要操作。' : '把下面的说明交给 Codex 或 Claude Code。密码由你在自己的终端或浏览器里输入，不要发给模型。'}
            footer={<Button variant="primary" onClick={onClose}>完成</Button>}>
            <pre className="prompt" tabIndex={0}>{onboardingText}</pre>
        </Dialog>
    );
}

// ---- demo controls (review only, not part of the product) ---------------------------

function DemoControls({ route, scene, actions }: { route: Route | 'account'; scene: Scene; actions: { goScene(value: string): void; setScenario(value: string): void; setRole(value: string): void; reset(): void } }) {
    const [open, setOpen] = useState(false);
    const [theme, setTheme] = useState('system');
    const changedDemo = (demo.settings.scenario !== 'normal' || demo.settings.role !== 'owner') && route !== 'account';
    const sceneValue = route === 'account' ? ({ register: 'register', login: 'login', 'expired-request': 'expired-request', recover: 'recover' } as Record<string, string>)[scene] ?? '' : 'first-run';
    const group = (title: string, control: ReactNode) => <div className="demo-group"><p className="demo-title">{title}</p>{control}</div>;
    const pick = (fn: (value: string) => void) => (value: string) => { setOpen(false); fn(value); };
    return (
        <Popover label="演示设置" align="end" className="demo-panel" open={open} onOpenChange={setOpen}
            trigger={<button type="button" className="demo-pill glass" data-changed={String(changedDemo)}><Icon name="flask" /><span>演示</span></button>}>
            <div className="demo-head"><strong>交互原型</strong><span>虚构数据，只保存在内存里；刷新即重置。</span></div>
            {(route === 'account' || demo.firstRun) && group('账号场景', <Segmented stacked label="账号场景" options={accountScenes} value={sceneValue} onValueChange={pick(actions.goScene)} />)}
            {route !== 'account' && group('数据场景', <Segmented stacked label="数据场景" options={scenarios} value={demo.settings.scenario} onValueChange={pick(actions.setScenario)} />)}
            {route !== 'account' && group('我在“产品协作”的角色', <Segmented label="我在“产品协作”的角色" value={demo.settings.role}
                options={['owner', 'admin', 'member'].map(value => ({ value, label: roleLabels[value] }))} onValueChange={actions.setRole} />)}
            {group('外观', <Segmented label="外观" value={theme} onValueChange={value => { setTheme(value); document.documentElement.dataset.theme = value; }}
                options={[{ value: 'system', label: '跟随系统', icon: 'display' }, { value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }]} />)}
            <Button icon="refresh" className="demo-reset" onClick={() => { setOpen(false); actions.reset(); }}>重置演示</Button>
        </Popover>
    );
}
