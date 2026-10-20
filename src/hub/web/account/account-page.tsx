import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Banner, Button, Form, Icon, Mark, PasswordField, SelectField, TextField } from '@runweft/ui';
import { HubApiError } from '../api/http';
import type { ConnectionRequest, Identity, Space } from '../api/hub';
import type { Notice } from '../workspace/context';

export type AuthScene = 'login' | 'register' | 'recover';

export type AccountPageProps = {
    scene: AuthScene;
    setScene(scene: AuthScene): void;
    notice: Notice | null;
    /** Present when the page was opened from a CLI connection link. */
    connect: { request?: ConnectionRequest; error?: HubApiError } | null;
    /** Signed in with a pending request: the user only has to confirm. */
    confirming: { identity: Identity; spaces: Space[]; preferred?: string } | null;
    authorized: boolean;
    signedIn: boolean;
    onLogin(username: string, password: string, register: boolean): Promise<void>;
    onReset(username: string, code: string, password: string): Promise<void>;
    onConfirm(spaceId: string): Promise<void>;
    onLeaveConnection(): void;
    onViewWorkspace(): void;
};

function errorBanner(error: HubApiError | null) {
    return error ? <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner> : null;
}

function useSubmit() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<HubApiError | null>(null);
    const submit = async (action: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await action(); }
        catch (failure) { setError(failure instanceof HubApiError ? failure : new HubApiError('error', '操作未能完成', failure instanceof Error ? failure.message : '')); }
        finally { setBusy(false); }
    };
    return { busy, error, submit };
}

function Card({ eyebrow, ok, title, intro, children }: { eyebrow: ReactNode; ok?: boolean; title: string; intro: ReactNode; children: ReactNode }) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
    return (
        <section className="auth-card" aria-labelledby="auth-title">
            <p className={ok ? 'auth-eyebrow ok' : 'auth-eyebrow'}>{ok && <Icon name="st-done" />}{eyebrow}</p>
            <h1 id="auth-title" ref={heading} tabIndex={-1}>{title}</h1>
            <p className="auth-intro">{intro}</p>
            {children}
        </section>
    );
}

function SignIn({ scene, setScene, notice, connecting, onLogin }: Pick<AccountPageProps, 'scene' | 'setScene' | 'notice' | 'onLogin'> & { connecting: boolean }) {
    const register = scene === 'register';
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { busy, error, submit } = useSubmit();
    const label = (register ? '注册' : '登录') + (connecting ? '并连接' : '');
    return (
        <Card eyebrow={connecting ? '连接你的工作环境' : 'Runweft Hub'} title={register ? '第一次使用 Runweft' : '欢迎回来'}
            intro={register ? '创建账号并连接，Agent 会继续准备你的第一次体验。' : connecting ? '登录后，把当前工作环境连接到你的账号。' : '用账号密码回到你的空间。'}>
            {notice && <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>}
            <Form onSubmit={() => submit(() => onLogin(username, password, register))}>
                <TextField label="用户名" required autoComplete="username" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)}
                    hint={register ? '用于登录，不能与已有用户名重复。' : '使用你在这个 Hub 注册的用户名。'} />
                <PasswordField label="密码" required autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} hint="支持粘贴和密码管理器。" />
                {errorBanner(error)}
                <div className="form-actions stretch"><Button type="submit" variant="primary" size="lg" disabled={busy}>{label}</Button></div>
            </Form>
            <div className="auth-links">
                {!register && <Button variant="link" onClick={() => setScene('recover')}>忘记密码？</Button>}
                <Button variant="link" onClick={() => setScene(register ? 'login' : 'register')}>{register ? '已有账号？登录' : '没有账号？注册'}</Button>
            </div>
            <p className="auth-foot">{register ? '显示名称默认使用用户名，并自动创建你的空间。' : '只退出当前浏览器不会断开已连接的命令行环境。'}</p>
        </Card>
    );
}

function Recover({ setScene, onReset }: Pick<AccountPageProps, 'setScene' | 'onReset'>) {
    const [username, setUsername] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const { busy, error, submit } = useSubmit();
    return (
        <Card eyebrow="找回账号" title="重置密码" intro="请联系这个 Hub 的部署者获取一次性重置码，再设置新密码。">
            <Form onSubmit={() => submit(() => onReset(username, code, password))}>
                <TextField label="用户名" required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} />
                <PasswordField label="一次性重置码" required autoComplete="off" value={code} onChange={event => setCode(event.target.value)} hint="由这个 Hub 的部署者提供，只用于这一次。" />
                <PasswordField label="新密码" required autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
                {errorBanner(error)}
                <div className="form-actions stretch"><Button type="submit" variant="primary" size="lg" disabled={busy}>重置密码</Button></div>
            </Form>
            <div className="auth-links"><Button variant="link" onClick={() => setScene('login')}>返回登录</Button></div>
        </Card>
    );
}

function Confirm({ confirming, onConfirm, onLeaveConnection }: { confirming: NonNullable<AccountPageProps['confirming']> } & Pick<AccountPageProps, 'onConfirm' | 'onLeaveConnection'>) {
    const { identity, spaces, preferred } = confirming;
    const [space, setSpace] = useState(preferred && spaces.some(item => item.id === preferred) ? preferred : spaces[0]?.id ?? '');
    const { busy, error, submit } = useSubmit();
    return (
        <Card eyebrow="连接你的工作环境" title="确认连接" intro="把这个工作环境连接到你的账号。核对右侧的地址、设备和核对码后确认。">
            <p className="auth-foot">当前账号：{identity.name}</p>
            <Form onSubmit={() => submit(() => onConfirm(space))}>
                {spaces.length > 1 && <SelectField label="连接后默认使用的空间" value={space} onChange={event => setSpace(event.target.value)}
                    options={spaces.map(item => ({ value: item.id, label: item.name }))} hint="这个环境发起的委派默认进入所选空间。" />}
                {errorBanner(error)}
                <div className="form-actions stretch"><Button type="submit" variant="primary" size="lg" disabled={busy || !space}>确认连接此账号</Button></div>
            </Form>
            <div className="auth-links"><Button variant="link" onClick={onLeaveConnection}>不连接，前往工作台</Button></div>
        </Card>
    );
}

function Authorized({ onViewWorkspace }: Pick<AccountPageProps, 'onViewWorkspace'>) {
    return (
        <Card ok eyebrow="已授权" title="可以返回原对话了" intro="Agent 会继续完成接入，并把第一份评审报告带回原对话。不需要再发送“已经点好”。">
            <Banner tone="info" title="本机是否连接完成、执行工具是否就绪，由 Agent 核对后告诉你。" />
            <div className="form-actions stretch"><Button size="lg" onClick={onViewWorkspace}>查看工作台</Button></div>
            <p className="auth-foot">也可以直接关闭这个标签页。</p>
        </Card>
    );
}

function Unavailable({ error, signedIn, onLeaveConnection }: { error?: HubApiError; signedIn: boolean; onLeaveConnection(): void }) {
    return (
        <Card eyebrow="连接你的工作环境" title="这个连接请求已不可用" intro="回到原对话，让 Agent 重新给出连接链接。已有账号会保留，不需要重新注册。">
            <Banner tone="warn" title={error?.message ?? '这次请求没有获得授权'}>{error?.hint || undefined}</Banner>
            <div className="form-actions stretch"><Button size="lg" onClick={onLeaveConnection}>{signedIn ? '查看工作台' : '用账号登录'}</Button></div>
        </Card>
    );
}

function RequestSide({ request, expired }: { request?: ConnectionRequest; expired: boolean }) {
    return (
        <aside className="auth-side glass" aria-label="核对连接请求">
            <h2>{expired ? '已不可用的连接请求' : '核对连接请求'}</h2>
            {request && (
                <dl className="verify">
                    <div><dt>Hub</dt><dd className="mono">{request.origin}</dd></div>
                    <div><dt>工作环境</dt><dd>{request.label}</dd></div>
                    <div className="verify-code"><dt>核对码</dt><dd className="mono">{request.code}</dd></div>
                </dl>
            )}
            <p className="hint">请与 Agent 给出的地址、设备和核对码核对。连接后，这个命令行环境能以你的账号访问有权使用的资源；可以随时在账号设置中断开。</p>
            <ol className="steps">
                <li data-done={String(request?.status === 'confirmed')}><span className="step-knot" aria-hidden="true" />用账号授权这个环境</li>
                <li><span className="step-knot" aria-hidden="true" />Agent 准备机器和执行工具</li>
                <li><span className="step-knot" aria-hidden="true" />在原对话读到第一份评审报告</li>
            </ol>
        </aside>
    );
}

export function AccountPage(props: AccountPageProps) {
    const { connect, confirming, authorized, signedIn, scene } = props;
    const unavailable = !!connect && !authorized && (!!connect.error || connect.request?.status === 'cancelled');
    let card: ReactNode;
    if (authorized) card = <Authorized onViewWorkspace={props.onViewWorkspace} />;
    else if (unavailable) card = <Unavailable error={connect?.error} signedIn={signedIn} onLeaveConnection={props.onLeaveConnection} />;
    else if (confirming) card = <Confirm confirming={confirming} onConfirm={props.onConfirm} onLeaveConnection={props.onLeaveConnection} />;
    else if (scene === 'recover') card = <Recover setScene={props.setScene} onReset={props.onReset} />;
    else card = <SignIn scene={scene} setScene={props.setScene} notice={props.notice} connecting={!!connect} onLogin={props.onLogin} />;
    const side = connect ? <RequestSide request={connect.request} expired={unavailable} /> : null;
    return (
        <div className="auth">
            <header className="auth-brand"><Mark /><span className="brand-name">Runweft</span><span className="brand-tag">Hub</span></header>
            <main className={side ? 'auth-grid' : 'auth-grid single'} id="page" tabIndex={-1}>{card}{side}</main>
        </div>
    );
}
