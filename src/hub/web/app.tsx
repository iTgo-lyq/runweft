import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Banner, Button, ConfirmProvider, EmptyState, Form, IconSprite, Loading, Mark, SkipLink, TextField, Toaster, toast } from '@runweft/ui';
import { AccountPage, type AuthScene } from './account/account-page';
import { HubApiError } from './api/http';
import { accounts, clearSaved, identityApi, readSaved, spaceApi, writeSaved, type ConnectionRequest, type Identity, type Space } from './api/hub';
import { patchHash, readHash, type View } from './route';
import { WorkspaceContext, type Notice, type Workspace } from './workspace/context';
import { PendingPage } from './workspace/pending-page';
import { SettingsPage } from './workspace/settings-page';
import { TasksPage } from './tasks/tasks-page';
import { MachinesPage } from './resources/machines-page';
import { RuntimesPage } from './resources/runtimes-page';
import { pages, WorkspaceShell } from './workspace/shell';

type Session = { token: string; identity: Identity; username: string; spaces: Space[]; space?: Space };
type Link = { id: string; request?: ConnectionRequest; error?: HubApiError };

const asError = (error: unknown) => error instanceof HubApiError ? error : new HubApiError('error', '操作未能完成', error instanceof Error ? error.message : '');
const expiredNotice: Notice = { tone: 'warn', title: '登录已失效', text: '请使用账号密码重新登录。' };

/** Reads the identity, spaces and account name, then picks the space from the link, the saved choice or the first. */
async function loadSession(token: string, preferred?: string): Promise<Session> {
    const api = identityApi(token);
    const [identity, spaces, account] = await Promise.all([api.identity(), api.spaces(), api.account()]);
    const linked = readHash().space;
    const space = linked ? spaces.find(item => item.id === linked) : spaces.find(item => item.id === preferred) ?? spaces[0];
    if (linked && !space) throw new HubApiError('error', '此链接的空间不可访问', '返回 Hub 选择你有权访问的空间。', 404, 'hub_space_link_unavailable');
    return { token, identity, username: account.username, spaces, space };
}

function remember(session: Session) {
    writeSaved({ token: session.token, ...(session.space ? { spaceId: session.space.id } : {}) });
}

/** Pages that have moved to the new interface. The rest show a placeholder until their task lands. */
function Page({ view }: { view: View }) {
    if (view === 'tasks') return <TasksPage />;
    if (view === 'machines') return <MachinesPage />;
    if (view === 'runtimes') return <RuntimesPage />;
    return view === 'settings' ? <SettingsPage /> : <PendingPage view={view} />;
}

export function HubApp() {
    const [ready, setReady] = useState(false);
    const [session, setSession] = useState<Session | null>(null);
    const [scene, setScene] = useState<AuthScene>('login');
    const [notice, setNotice] = useState<Notice | null>(null);
    const [link, setLink] = useState<Link | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [view, setView] = useState<View>('tasks');
    const [returnTo, setReturnTo] = useState<View | null>(null);
    const [alert, setAlert] = useState<HubApiError | null>(null);
    const [blocked, setBlocked] = useState<HubApiError | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);
    const [focusTick, setFocusTick] = useState(0);
    const [onboarding, setOnboarding] = useState<'hub' | 'machine' | null>(null);
    // Counts external hash changes; a link opened in this tab remounts the page so it reads the new task or round.
    const [linkTick, setLinkTick] = useState(0);
    const preferred = useRef<string | undefined>(undefined);

    const signOut = useCallback((next: Notice) => {
        try { writeSaved({ token: '' }); } catch { try { clearSaved(); } catch { /* storage unavailable: nothing left to clear */ } }
        setSession(null); setAlert(null); setOnboarding(null); setScene('login'); setNotice(next);
    }, []);

    // Boot and every external hash change (a CLI link opened in this tab) re-read the session and the link.
    const evaluate = useCallback(async () => {
        setBlocked(null); setLinkTick(value => value + 1);
        let saved: ReturnType<typeof readSaved> = { token: '' };
        let first: Notice | null = null;
        try { saved = readSaved(); } catch (error) { first = { tone: 'danger', title: asError(error).message, text: asError(error).hint || undefined }; }
        preferred.current = saved.spaceId;
        const hash = readHash();
        if (hash.nativeExpired) {
            first = { tone: 'warn', title: '原生页面的限时访问已失效', text: '请在已登录的 Hub 中重新打开，或使用账号密码登录。' };
            patchHash({ 'native-expired': null });
        }
        let next: Link | null = null;
        if (hash.connect) {
            try { next = { id: hash.connect, request: await accounts.connection(hash.connect) }; }
            catch (error) { next = { id: hash.connect, error: asError(error) }; }
        }
        setLink(next); setAuthorized(next?.request?.status === 'confirmed');
        if (!saved.token) {
            setSession(null); setScene(hash.connect ? 'register' : 'login'); setNotice(first); setReady(true);
            return;
        }
        try {
            const loaded = await loadSession(saved.token, saved.spaceId);
            remember(loaded);
            setSession(loaded); setView(hash.task ? 'tasks' : hash.view ?? 'tasks'); setNotice(null);
            setAlert(first && new HubApiError('error', first.title, first.text ?? ''));
        } catch (error) {
            const failure = asError(error);
            if (failure.kind === 'expired') signOut(first ?? expiredNotice);
            else { setSession(null); setBlocked(failure); }
        }
        setReady(true);
    }, [signOut]);

    useEffect(() => {
        void evaluate();
        const onHash = () => void evaluate();
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [evaluate]);

    const confirmConnection = useCallback(async (spaceId: string, current: Session) => {
        const request = link?.request;
        if (!link || !request || request.status !== 'pending') return;
        try {
            const confirmed = await identityApi(current.token).confirmConnection(request.id, spaceId);
            setLink({ id: link.id, request: confirmed });
        } catch (error) {
            // The answer may have been lost after the Hub accepted it; only a confirmed request counts as done.
            const latest = await accounts.connection(request.id).catch(() => undefined);
            if (latest?.status !== 'confirmed') throw error;
            setLink({ id: link.id, request: latest });
        }
        setAuthorized(true);
    }, [link]);

    const onLogin = useCallback(async (username: string, password: string, register: boolean) => {
        const hint = preferred.current;
        const { token } = register ? await accounts.register(username, password) : await accounts.login(username, password);
        writeSaved({ token });
        let loaded: Session;
        try { loaded = await loadSession(token, hint); }
        catch (error) {
            // Signed in, but the link points at a space this account cannot open: say so instead of a login error.
            if (asError(error).code !== 'hub_space_link_unavailable') throw error;
            setBlocked(asError(error)); return;
        }
        remember(loaded);
        const hash = readHash();
        setSession(loaded); setNotice(null); setAlert(null); setView(returnTo ?? (hash.task ? 'tasks' : hash.view) ?? 'tasks'); setReturnTo(null);
        if (link?.request?.status !== 'pending') return;
        if (loaded.spaces.length === 1) await confirmConnection(loaded.spaces[0].id, loaded);
        else if (hint && loaded.spaces.some(space => space.id === hint)) await confirmConnection(hint, loaded);
    }, [confirmConnection, link, returnTo]);

    const onReset = useCallback(async (username: string, code: string, password: string) => {
        await accounts.resetPassword(username, code, password);
        writeSaved({ token: '' });
        setScene('login'); setNotice({ tone: 'ok', title: '密码已更新', text: '请使用新密码登录。' });
    }, []);

    const leaveConnection = useCallback(() => {
        patchHash({ connect: null });
        setLink(null); setAuthorized(false);
        if (!session) setScene('login');
    }, [session]);

    const reloadIdentity = useCallback(async ({ spaceId }: { spaceId?: string } = {}) => {
        if (!session) return;
        // An explicit choice wins over a space carried in the link.
        const linked = readHash().space;
        if (spaceId && linked && linked !== spaceId) patchHash({ space: null, task: null, round: null });
        try {
            const loaded = await loadSession(session.token, spaceId ?? session.space?.id);
            remember(loaded);
            setSession(loaded);
        } catch (error) {
            const failure = asError(error);
            if (failure.kind === 'expired') signOut(expiredNotice);
            else setAlert(failure);
        }
    }, [session, signOut]);

    // ---- workspace context ---------------------------------------------------------------
    // Everything a page reads is tied to this key. Switching account or space remounts the page, and space
    // requests made under an older key are refused, so one context's answer never lands in another.
    const token = session?.token ?? '', userId = session?.identity.id ?? '', spaceId = session?.space?.id ?? '';
    const contextKey = spaceId ? `${userId}:${token}:${spaceId}` : '';
    const currentKey = useRef(contextKey);
    currentKey.current = contextKey;
    const accountApi = useMemo(() => identityApi(token), [token]);
    const resourceApi = useMemo(() => spaceApi({ token, userId, spaceId }, () => currentKey.current === `${userId}:${token}:${spaceId}`), [token, userId, spaceId]);

    const expire = useCallback(() => {
        setReturnTo(view);
        signOut({ tone: 'warn', title: '登录已失效', text: `重新登录后回到“${pages[view].label}”。` });
    }, [signOut, view]);

    const navigate = useCallback<Workspace['navigate']>((next, { focus = true } = {}) => {
        setAlert(null); setView(next);
        patchHash({ view: next, ...(next === 'tasks' ? {} : { task: null, round: null }) });
        if (focus) setFocusTick(value => value + 1);
    }, []);

    const refresh = useCallback(() => {
        setAlert(null); void reloadIdentity(); setRefreshTick(value => value + 1);
    }, [reloadIdentity]);

    const run = useCallback<Workspace['run']>(async (action, { success, onError } = {}) => {
        try {
            const result = await action();
            if (success) toast(success);
            return (result ?? true) as Awaited<ReturnType<typeof action>>;
        } catch (error) {
            const failure = asError(error);
            if (failure.kind === 'expired') { expire(); return undefined; }
            if (onError) onError(failure); else setAlert(failure);
            return undefined;
        }
    }, [expire]);

    const switchSpace = useCallback((id: string) => {
        if (!session) return;
        const target = session.spaces.find(item => item.id === id);
        patchHash({ space: null, task: null, round: null });
        setAlert(null);
        void reloadIdentity({ spaceId: id }).then(() => { if (target) toast(`已切换到“${target.name}”`); });
    }, [reloadIdentity, session]);

    const workspace = useMemo<Workspace | null>(() => session?.space ? {
        identity: session.identity, username: session.username, spaces: session.spaces, space: session.space, role: session.space.role,
        identityApi: accountApi, spaceApi: resourceApi, view, refreshTick,
        navigate, refresh, run, showAlert: setAlert, reloadIdentity, switchSpace, signOut, expire,
        showOnboarding: kind => setOnboarding(kind ?? 'hub'),
    } : null, [session, accountApi, resourceApi, view, refreshTick, navigate, refresh, run, reloadIdentity, switchSpace, signOut, expire]);

    useEffect(() => {
        if (!focusTick) return;
        requestAnimationFrame(() => document.querySelector<HTMLElement>('#page h1')?.focus());
    }, [focusTick, view]);

    // ---- screens ---------------------------------------------------------------------------
    let screen: ReactNode;
    const pending = link?.request?.status === 'pending';
    const authProps = {
        scene, notice, onLogin, onReset, onLeaveConnection: leaveConnection, onViewWorkspace: leaveConnection,
        setScene: (next: AuthScene) => { setScene(next); setNotice(null); },
    };
    if (!ready) screen = <Loading>正在打开 Runweft Hub…</Loading>;
    else if (blocked) {
        screen = (
            <Standalone>
                <EmptyState icon="lock" tone="warn" title={blocked.message}
                    actions={<Button variant="primary" onClick={() => { history.replaceState(null, '', '/hub'); void evaluate(); }}>返回 Hub</Button>}>{blocked.hint || undefined}</EmptyState>
            </Standalone>
        );
    } else if (link && (authorized || !session || pending || link.error || link.request?.status === 'cancelled')) {
        screen = <AccountPage {...authProps} connect={link} authorized={authorized} signedIn={!!session}
            confirming={session && pending ? { identity: session.identity, spaces: session.spaces, preferred: preferred.current } : null}
            onConfirm={spaceId => confirmConnection(spaceId, session!)} />;
    } else if (!session) {
        screen = <AccountPage {...authProps} connect={null} authorized={false} signedIn={false} confirming={null} onConfirm={async () => {}} />;
    } else if (!workspace) {
        screen = <NoSpace token={session.token} onJoined={id => void reloadIdentity({ spaceId: id })} onSignOut={() => signOut({ tone: 'info', title: '已退出当前浏览器', text: '可以用账号密码重新登录。' })} />;
    } else {
        const tone = alert?.kind === 'unknown' ? 'warn' : alert?.kind === 'unreachable' ? 'offline' : 'danger';
        screen = (
            <WorkspaceContext.Provider value={workspace}>
                <WorkspaceShell onboarding={onboarding} onOnboardingChange={setOnboarding} alert={alert && (
                    <Banner tone={tone} title={alert.message} actions={<>
                        {alert.kind === 'unknown' && <Button size="sm" icon="refresh" onClick={refresh}>刷新核对</Button>}
                        <Button size="sm" icon="x" iconOnly label="关闭提示" variant="ghost" onClick={() => setAlert(null)} />
                    </>}>{alert.hint || undefined}</Banner>
                )}>
                    <Fragment key={`${contextKey}:${linkTick}`}><Page view={view} /></Fragment>
                </WorkspaceShell>
            </WorkspaceContext.Provider>
        );
    }
    return <ConfirmProvider><IconSprite /><SkipLink />{screen}<Toaster /></ConfirmProvider>;
}

function Standalone({ children }: { children: ReactNode }) {
    return (
        <div className="auth">
            <header className="auth-brand"><Mark /><span className="brand-name">Runweft</span><span className="brand-tag">Hub</span></header>
            <main className="auth-grid single" id="page" tabIndex={-1}><section className="auth-card">{children}</section></main>
        </div>
    );
}

/** An account can be left without a space after leaving all of them; offer both ways back in. */
function NoSpace({ token, onJoined, onSignOut }: { token: string; onJoined(spaceId: string): void; onSignOut(): void }) {
    const api = useMemo(() => identityApi(token), [token]);
    const [name, setName] = useState('');
    const [invitation, setInvitation] = useState('');
    const [error, setError] = useState<HubApiError | null>(null);
    const attempt = async (action: () => Promise<Space>) => {
        setError(null);
        try { onJoined((await action()).id); } catch (failure) { setError(asError(failure)); }
    };
    return (
        <Standalone>
            <h1 tabIndex={-1}>你还没有空间</h1>
            <p className="auth-intro">创建一个空间来登记资源和委派任务，或者粘贴成员发给你的邀请。</p>
            {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
            <Form onSubmit={() => attempt(() => api.createSpace(name.trim()))} actions={<Button type="submit" variant="primary">创建空间</Button>}>
                <TextField label="空间名称" required maxLength={80} placeholder="例如：设计评审" value={name} onChange={event => setName(event.target.value)} />
            </Form>
            <Form onSubmit={() => attempt(() => api.acceptInvitation(invitation.trim()))} actions={<Button type="submit">加入空间</Button>}>
                <TextField label="邀请" required mono spellCheck={false} autoComplete="off" placeholder="rw_inv_…" value={invitation} onChange={event => setInvitation(event.target.value)} />
            </Form>
            <div className="auth-links"><Button variant="link" onClick={onSignOut}>退出此浏览器</Button></div>
        </Standalone>
    );
}
