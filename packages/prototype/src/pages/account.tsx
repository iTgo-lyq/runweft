import { useState, type ReactNode } from 'react';
import { Banner, Button, Form, Icon, Mark, PasswordField, SelectField, TextField } from '@runweft/ui';
import { HubError } from '../mock.js';
import { demo, type Notice, type Route } from '../proto';

export type Scene = 'register' | 'login' | 'signin' | 'authorized' | 'expired-request' | 'recover';
const request = { hub: 'hub.example.com', device: '林舟的 MacBook Pro', code: '8F2C 61A9' };

type Props = { scene: Scene; notice: Notice | null; setScene(scene: Scene, notice?: Notice | null): void; signedIn(target?: Route): void };

function useFailure() {
    const [error, setError] = useState<HubError | null>(null);
    const attempt = async (action: () => Promise<void>) => {
        setError(null);
        try { await action(); } catch (failure) { if (failure instanceof HubError) setError(failure); else throw failure; }
    };
    return { attempt, banner: error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner> };
}

// Scenes: register / login (both carry a CLI connection request), signin (plain), authorized, expired-request, recover.
export function AccountPage({ scene, notice, setScene, signedIn }: Props) {
    const connecting = ['register', 'login', 'authorized', 'expired-request'].includes(scene);
    let card: ReactNode;
    if (scene === 'register' || scene === 'login' || scene === 'signin') card = <SignIn key={scene} scene={scene} notice={notice} setScene={setScene} signedIn={signedIn} connecting={connecting} />;
    else if (scene === 'authorized') {
        card = (
            <>
                <p className="auth-eyebrow ok"><Icon name="st-done" />已授权</p>
                <h1 id="auth-title" tabIndex={-1}>可以返回原对话了</h1>
                <p className="auth-intro">Agent 会继续完成接入，并把第一份评审报告带回原对话。不需要再发送“已经点好”。</p>
                <Banner tone="info" title="本机是否连接完成、执行工具是否就绪，由 Agent 核对后告诉你。" />
                <div className="form-actions stretch"><Button size="lg" onClick={() => signedIn('tasks')}>查看工作台</Button></div>
                <p className="auth-foot">{notice?.first ? '你的账号和“我的空间”已经创建好。也可以直接关闭这个标签页。' : '也可以直接关闭这个标签页。'}</p>
            </>
        );
    } else if (scene === 'expired-request') {
        card = (
            <>
                <p className="auth-eyebrow">连接你的工作环境</p>
                <h1 id="auth-title" tabIndex={-1}>这个连接请求已过期</h1>
                <p className="auth-intro">回到原对话，让 Agent 重新给出连接链接。已有账号会保留，不需要重新注册。</p>
                <Banner tone="warn" title="这次请求没有获得授权" />
                <div className="form-actions stretch"><Button size="lg" onClick={() => setScene('signin')}>用账号登录</Button></div>
            </>
        );
    } else card = <Recover setScene={setScene} />;
    return (
        <div className="auth">
            <header className="auth-brand"><Mark /><span className="brand-name">Runweft</span><span className="brand-tag">Hub</span></header>
            <main className={connecting ? 'auth-grid' : 'auth-grid single'} id="page" tabIndex={-1}>
                <section className="auth-card" aria-labelledby="auth-title">{card}</section>
                {connecting && (
                    <aside className="auth-side glass" aria-label="核对连接请求">
                        <h2>{scene === 'expired-request' ? '已过期的连接请求' : '核对连接请求'}</h2>
                        <dl className="verify">
                            <div><dt>Hub</dt><dd className="mono">{request.hub}</dd></div>
                            <div><dt>工作环境</dt><dd>{request.device}</dd></div>
                            <div className="verify-code"><dt>核对码</dt><dd className="mono">{request.code}</dd></div>
                        </dl>
                        <p className="hint">请与 Agent 给出的地址、设备和核对码核对。连接后，这个命令行环境能以你的账号访问有权使用的资源；可以随时在账号设置中断开。</p>
                        <ol className="steps">
                            <li data-done={String(scene === 'authorized')}><span className="step-knot" aria-hidden="true" />用账号授权这个环境</li>
                            <li><span className="step-knot" aria-hidden="true" />Agent 准备机器和执行工具</li>
                            <li><span className="step-knot" aria-hidden="true" />在原对话读到第一份评审报告</li>
                        </ol>
                    </aside>
                )}
            </main>
        </div>
    );
}

function SignIn({ scene, notice, setScene, signedIn, connecting }: Omit<Props, 'scene'> & { scene: 'register' | 'login' | 'signin'; connecting: boolean }) {
    const register = scene === 'register';
    const [username, setUsername] = useState(register ? '' : 'linzhou');
    const [password, setPassword] = useState('');
    const [space, setSpace] = useState('space-7c21');
    const { attempt, banner } = useFailure();
    const label = register ? '注册并连接' : scene === 'login' ? '登录并连接' : '登录';
    return (
        <>
            <p className="auth-eyebrow">{connecting ? '连接你的工作环境' : 'Runweft Hub'}</p>
            <h1 id="auth-title" tabIndex={-1}>{register ? '第一次使用 Runweft' : '欢迎回来'}</h1>
            <p className="auth-intro">{register ? '创建账号并连接，Agent 会继续准备你的第一次体验。' : scene === 'login' ? '登录后，把当前工作环境连接到你的账号。' : '用账号密码回到你的空间。'}</p>
            {notice?.title && <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>}
            <Form onSubmit={() => attempt(async () => {
                if (register) { await demo.api.register(username); setScene('authorized', { tone: 'ok', title: '', first: true }); return; }
                await demo.api.login(username);
                if (scene === 'login') setScene('authorized'); else signedIn();
            })}>
                <TextField label="用户名" required autoComplete="username" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)}
                    hint={register ? '用于登录，不能与已有用户名重复。' : '使用你在这个 Hub 注册的用户名。'} />
                <PasswordField label="密码" required autoComplete={register ? 'new-password' : 'current-password'} hint="支持粘贴和密码管理器。" value={password} onChange={event => setPassword(event.target.value)} />
                {scene === 'login' && <SelectField label="连接后默认使用的空间" value={space} onChange={event => setSpace(event.target.value)} hint="你在多个空间里。这个环境发起的委派默认进入所选空间。"
                    options={[{ value: 'space-7c21', label: '产品协作' }, { value: 'space-a903', label: '个人实验' }]} />}
                {banner}
                <div className="form-actions stretch"><Button type="submit" variant="primary" size="lg">{label}</Button></div>
            </Form>
            <div className="auth-links">
                {!register && <Button variant="link" onClick={() => setScene('recover')}>忘记密码？</Button>}
                {connecting && <Button variant="link" onClick={() => setScene(register ? 'login' : 'register')}>{register ? '已有账号？登录' : '没有账号？注册'}</Button>}
            </div>
            <p className="auth-foot">{register ? '显示名称默认使用用户名，并自动创建你的空间。' : '只退出当前浏览器不会断开已连接的命令行环境。'}</p>
        </>
    );
}

function Recover({ setScene }: Pick<Props, 'setScene'>) {
    const [username, setUsername] = useState('linzhou');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const { attempt, banner } = useFailure();
    return (
        <>
            <p className="auth-eyebrow">找回账号</p>
            <h1 id="auth-title" tabIndex={-1}>重置密码</h1>
            <p className="auth-intro">请联系这个 Hub 的部署者获取一次性重置码，再设置新密码。</p>
            <Form onSubmit={() => attempt(async () => {
                await demo.api.resetPassword(username, code);
                setScene('signin', { tone: 'ok', title: '密码已更新', text: '请使用新密码登录。' });
            })}>
                <TextField label="用户名" required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} />
                <PasswordField label="一次性重置码" required autoComplete="off" hint="由这个 Hub 的部署者提供，只用于这一次。演示中输入 demo。" value={code} onChange={event => setCode(event.target.value)} />
                <PasswordField label="新密码" required autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
                {banner}
                <div className="form-actions stretch"><Button type="submit" variant="primary" size="lg">重置密码</Button></div>
            </Form>
            <div className="auth-links"><Button variant="link" onClick={() => setScene('signin')}>返回登录</Button></div>
        </>
    );
}
