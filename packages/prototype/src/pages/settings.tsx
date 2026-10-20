import { useState } from 'react';
import { Badge, Banner, Block, Button, Dialog, Facts, Form, Icon, InlineEdit, Mono, PageHead, PasswordField, useConfirm } from '@runweft/ui';
import type { HubError } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';
import { relative } from '../time-format';

export function SettingsPage() {
    const proto = useProto(), confirm = useConfirm();
    const page = usePage(() => demo.api.account());
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [passwordError, setPasswordError] = useState<HubError | null>(null);
    const [logoutAll, setLogoutAll] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [logoutError, setLogoutError] = useState<HubError | null>(null);
    return (
        <Loaded page={page} label="账号设置">{({ user, environments }) => (
            <div className="page-inner narrow">
                <PageHead title="账号设置" description="管理你的账号、登录环境和密码。" />
                <Block title="个人资料">
                    <Facts rows={[
                        ['用户名', <><Mono>{user.username}</Mono><small className="muted"> · 用于登录，不能修改</small></>],
                        ['显示名称', <InlineEdit label="显示名称" value={user.name} onSave={async name => {
                            const done = await proto.run(() => demo.api.updateDisplayName(name), { success: '显示名称已保存' });
                            if (!done) return false;
                            proto.changed(); proto.refresh();
                        }} />],
                    ]} />
                </Block>
                <Block title="登录环境">
                    <p className="section-lead">每个浏览器和命令行环境都可以单独断开。断开只影响它的账号访问。</p>
                    <ul className="line-list">
                        {environments.map((env: any) => (
                            <li key={env.id} className="line" data-revoked={String(env.revoked)}>
                                <span className="line-icon"><Icon name={env.kind === 'cli' ? 'terminal' : 'browser'} /></span>
                                <div className="line-main">
                                    <strong>{env.label}{env.current && <Badge tone="accent">当前环境</Badge>}</strong>
                                    <small>{env.kind === 'cli' ? '命令行' : '浏览器'} · {env.revoked ? '已断开' : `最近使用：${relative(env.lastUsedAt)}`}</small>
                                </div>
                                {env.current || env.revoked ? <span className="line-spacer" /> : (
                                    <Button size="sm" variant="ghost" onClick={async () => {
                                        if (!await confirm('这个环境将无法继续访问你的账号。已接受的任务会继续执行，机器的 Runner 凭据不受影响。', { title: `断开“${env.label}”？`, confirmLabel: '断开环境', danger: true })) return;
                                        if (await proto.run(() => demo.api.revokeEnvironment(env.id), { success: `已断开“${env.label}”` })) proto.refresh();
                                    }}>断开</Button>
                                )}
                            </li>
                        ))}
                    </ul>
                </Block>
                <Block title="修改密码">
                    <p className="section-lead">修改后，所有浏览器和命令行都需要用新密码重新登录。</p>
                    <Form onSubmit={async () => {
                        setPasswordError(null);
                        const done = await proto.run(() => demo.api.changePassword(current, next), { onError: setPasswordError });
                        if (done) proto.signedOut({ tone: 'ok', title: '密码已更新', text: '所有浏览器和命令行都已退出，请使用新密码登录。' });
                    }} actions={<Button type="submit" variant="primary">修改密码并退出全部环境</Button>}>
                        <PasswordField label="当前密码" required autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} />
                        <PasswordField label="新密码" required autoComplete="new-password" hint="支持粘贴和密码管理器。" value={next} onChange={event => setNext(event.target.value)} />
                        {passwordError && <Banner tone="danger" title={passwordError.message}>{passwordError.hint || undefined}</Banner>}
                    </Form>
                </Block>
                <Block title="退出全部环境" className="danger-zone">
                    <p className="section-lead">所有浏览器和命令行都需要重新登录。账号、空间、资源和已接受的任务都会保留。</p>
                    <Button variant="danger" onClick={() => { setConfirmPassword(''); setLogoutError(null); setLogoutAll(true); }}>退出全部环境…</Button>
                </Block>
                <Dialog open={logoutAll} onOpenChange={setLogoutAll} size="sm" title="退出全部环境？" description="需要验证当前密码。已接受的任务会继续执行。"
                    footer={<><Button onClick={() => setLogoutAll(false)}>取消</Button><Button type="submit" form="logout-all" variant="primary">确认退出全部环境</Button></>}>
                    <Form id="logout-all" onSubmit={async () => {
                        setLogoutError(null);
                        const done = await proto.run(() => demo.api.logoutAll(confirmPassword), { onError: setLogoutError });
                        if (!done) return;
                        setLogoutAll(false);
                        proto.signedOut({ tone: 'info', title: '已退出全部环境', text: '可以用账号密码重新登录。' });
                    }}>
                        <PasswordField label="当前密码" required autoComplete="current-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
                        {logoutError && <Banner tone="danger" title={logoutError.message}>{logoutError.hint || undefined}</Banner>}
                    </Form>
                </Dialog>
            </div>
        )}</Loaded>
    );
}
