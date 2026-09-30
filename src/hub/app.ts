export default '';
type Identity = { id: string; name: string; createdAt: number };
type Role = 'owner' | 'admin' | 'member';
type Space = { id: string; name: string; role: Role };
type Member = { userId: string; name: string; role: Role };
type Invitation = { id: string; role: 'admin' | 'member'; expiresAt: number };
type Saved = { token: string; pendingToken?: string; spaceId?: string };
const storageKey = 'runweft.hub.identity', labels = { owner: '所有者', admin: '管理员', member: '成员' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const secretDialog = $<HTMLDialogElement>('secret-dialog'), confirmDialog = $<HTMLDialogElement>('confirm-dialog');
let saved: Saved = { token: '' }, identity: Identity | undefined, spaces: Space[] = [], selected: Space | undefined;
let busy = false, secret = '', secretKind: 'identity' | 'invitation' | 'rotation' = 'identity';
type ConnectionRequest = { id: string; origin: string; label: string; publicKey: string; code: string; expiresAt: number; status: string };
let connectionRequest: ConnectionRequest | undefined;
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function notice(message: string, error = false) {
    $('notice').textContent = message; $('notice').hidden = !message; $('notice').dataset.error = String(error);
}
function persist() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch { throw new Error('浏览器无法保存当前身份。请允许此站点使用会话存储，并保留 token 副本。'); }
}
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token = saved.token, base = '/api/runweft/hub'): Promise<any> {
    let response: Response;
    try { response = await fetch(`${base}${path}`, { method, credentials: 'omit', redirect: 'error', headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ApiError(0, '无法连接 Hub。写操作的结果可能尚未确认，请先刷新核对，不要重复提交。'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, [data.error?.message ?? '请求未能完成。', data.error?.hint].filter(Boolean).join(' '));
    return data;
}
async function action(fn: () => Promise<void>) {
    if (busy) return;
    busy = true; notice('');
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select'));
    const disabled = controls.map(node => node.disabled);
    controls.forEach(node => { node.disabled = true; });
    try { await fn(); }
    catch (error) {
        if (error instanceof ApiError && error.status === 401) showEntry();
        const message = error instanceof Error ? error.message : '操作未能完成，请刷新核对。';
        notice(message, true);
        if (secretDialog.open) $('secret-status').textContent = message;
    } finally {
        controls.forEach((node, i) => { if (node.isConnected) node.disabled = disabled[i]; }); busy = false;
    }
}
function form(id: string, fn: () => Promise<void>) { $(id).addEventListener('submit', event => { event.preventDefault(); void action(fn); }); }
function click(id: string, fn: () => Promise<void>) { $(id).addEventListener('click', () => { void action(fn); }); }
function text(tag: string, value: string, className?: string) {
    const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node;
}
function button(value: string, fn: () => Promise<void>, className = 'secondary') {
    const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = value;
    node.addEventListener('click', () => { void action(fn); }); return node;
}
function canAssign(actor: Role, role: Role) { return actor === 'owner' || (actor === 'admin' && role === 'member'); }
function showEntry() {
    identity = undefined; selected = undefined; spaces = [];
    $('entry').hidden = false; $('workspace').hidden = true; $('logout').hidden = true;
    $('headline').textContent = '从你的身份开始'; $('intro').textContent = '无需注册。保存你的身份 token，下次凭它回到自己的空间。';
    for (const id of ['identity-name', 'identity-id', 'space-name', 'space-id', 'members', 'invitations', 'spaces']) $(id).replaceChildren();
    renderConnection();
}
async function refresh() {
    identity = (await api('/identity')).identity;
    spaces = (await api('/spaces')).spaces;
    $('entry').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
    $('headline').textContent = '你的空间'; $('intro').textContent = '选择空间，查看成员和管理协作范围。';
    $('identity-name').textContent = identity!.name; $('identity-id').textContent = identity!.id; input('identity-name-input').value = identity!.name;
    selected = spaces.find(space => space.id === saved.spaceId) ?? spaces[0];
    saved.spaceId = selected?.id; persist();
    await refreshConnection();
    $('spaces').replaceChildren(...spaces.map(space => {
        const node = button('', async () => { saved.spaceId = space.id; persist(); await refresh(); });
        node.append(text('span', space.name), text('span', labels[space.role]));
        if (space.id === selected?.id) node.setAttribute('aria-current', 'page'); return node;
    }));
    const section = document.querySelector<HTMLElement>('.space-content')!;
    section.hidden = !selected;
    if (!selected) return;
    const space = selected, route = `/spaces/${encodeURIComponent(space.id)}`;
    $('space-name').textContent = space.name; $('space-id').textContent = space.id; $('space-role').textContent = `当前角色 · ${labels[space.role]}`;
    input('space-name-input').value = space.name;
    const manage = space.role !== 'member'; $('rename-space').hidden = !manage; $('invitation-manager').hidden = !manage;
    const roleSelect = $<HTMLSelectElement>('invitation-role');
    roleSelect.replaceChildren(new Option('成员', 'member'), ...(space.role === 'owner' ? [new Option('管理员', 'admin')] : []));
    $('members').replaceChildren(); $('invitations').replaceChildren();
    const [members, invitations] = await Promise.all([api(route + '/members'), manage ? api(route + '/invitations') : Promise.resolve({ invitations: [] })]);
    $('member-count').textContent = String(members.members.length);
    $('members').replaceChildren(...members.members.map((member: Member) => {
        const row = document.createElement('tr'), name = document.createElement('td'), role = document.createElement('td'), actions = document.createElement('td');
        name.append(text('span', member.name + (member.userId === identity!.id ? '（你）' : '')), text('code', member.userId));
        role.textContent = labels[member.role];
        const group = text('div', '', 'member-actions');
        if (space.role === 'owner') {
            const select = document.createElement('select'); select.setAttribute('aria-label', `${member.name}的角色`);
            for (const [value, label] of Object.entries(labels)) select.add(new Option(label, value));
            select.value = member.role;
            group.append(select, button('保存', async () => {
                if (select.value === member.role) return;
                if (!await confirm(`将 ${member.name} 的角色改为${labels[select.value as Role]}？`)) return;
                await api(route + `/members/${member.userId}`, { role: select.value }, 'PATCH'); await refresh(); notice('成员角色已更新。');
            }));
        }
        if (canAssign(space.role, member.role) && member.userId !== identity!.id) group.append(button('移除', async () => {
            if (!await confirm(`将 ${member.name} 移出 ${space.name}？`)) return;
            await api(route + `/members/${member.userId}`, undefined, 'DELETE'); await refresh(); notice('成员已移除。');
        }, 'quiet'));
        actions.append(group); row.append(name, role, actions); return row;
    }));
    if (manage) $('invitations').replaceChildren(...(invitations.invitations.length ? invitations.invitations.map((invite: Invitation) => {
        const node = text('div', '', 'invitation');
        node.append(text('span', `${labels[invite.role]}邀请 · ${new Date(invite.expiresAt).toLocaleString('zh-CN')} 到期`));
        if (canAssign(space.role, invite.role)) node.append(button('撤销', async () => {
            await api(route + `/invitations/${invite.id}`, undefined, 'DELETE'); await refresh(); notice('邀请已撤销。');
        }, 'quiet'));
        return node;
    }) : [text('p', '没有待使用的邀请。', 'hint')]));
}
function confirm(message: string): Promise<boolean> {
    $('confirm-description').textContent = message; confirmDialog.returnValue = '';
    // The dialog controls are enabled even while the initiating action is pending.
    confirmDialog.querySelectorAll('button').forEach(node => { node.disabled = false; });
    confirmDialog.showModal();
    return new Promise(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'yes'), { once: true }));
}
function showSecret(value: string, kind: typeof secretKind) {
    secret = value; secretKind = kind; $('secret-value').textContent = value; $('secret-status').textContent = '';
    $('secret-title').textContent = kind === 'invitation' ? '分享这个空间邀请' : kind === 'rotation' ? '先保存新的身份 token' : '保存你的身份 token';
    $('secret-description').textContent = kind === 'invitation' ? '把邀请交给希望加入的成员。24 小时内仅能由一人使用。'
        : kind === 'rotation' ? '保存副本后再应用。应用成功后旧 token 将立即失效，其他设备需要导入新 token。'
        : '这个 token 是回到原身份的凭据。请下载或复制留存；没有副本时无法找回。';
    $('apply-rotation').hidden = kind !== 'rotation';
    if (!secretDialog.open) secretDialog.showModal();
}
function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return 'rw_id_' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function recover() {
    if (saved.pendingToken) {
        try {
            await api('/identity', undefined, 'GET', saved.pendingToken);
            saved.token = saved.pendingToken; delete saved.pendingToken; persist(); return;
        } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    }
    await api('/identity'); delete saved.pendingToken; persist();
}

function renderConnection() {
    const request = connectionRequest;
    $('connect-request').hidden = !request;
    $('confirm-connection').hidden = true;
    if (!request) return;
    $('connect-details').textContent = `Hub：${request.origin} · 机器：${request.label} · ${new Date(request.expiresAt).toLocaleString('zh-CN')} 到期`;
    $('connect-code').textContent = request.code;
    $('connect-identity').textContent = request.status === 'pending' && identity && selected
        ? `将连接身份「${identity.name}」与空间「${selected.name}」。可在下方切换空间。` : '';
    let status: string;
    if (request.origin !== location.origin) status = '请求的 Hub 地址与当前页面不一致，无法确认。请重新发起正确地址的请求。';
    else if (!isSecureContext || !crypto.subtle) status = '浏览器需要 HTTPS 或 localhost 才能加密身份凭据。';
    else if (request.expiresAt <= Date.now()) status = '此请求已过期，请让 Agent 重新发起。';
    else if (request.status === 'confirmed' || request.status === 'consumed') status = '连接已确认。请让 Agent 执行 hub connect complete 完成本机保存。';
    else if (request.status !== 'pending') status = '此请求已取消，请重新发起。';
    else if (!identity || !selected) status = '先进入你的身份并选择空间，再确认连接。';
    else { status = '确认前请与 Agent 提供的代码核对。'; $('confirm-connection').hidden = false; }
    $('connect-status').textContent = status;
}
async function refreshConnection() {
    const id = new URLSearchParams(location.hash.slice(1)).get('connect');
    if (!id) { connectionRequest = undefined; renderConnection(); return; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('连接请求 ID 无效。请打开 Agent 提供的完整链接。');
    connectionRequest = undefined; renderConnection();
    connectionRequest = await api(`/${id}`, undefined, 'GET', '', '/api/runweft/connect'); renderConnection();
}
click('confirm-connection', async () => {
    await refreshConnection();
    const request = connectionRequest;
    if (!request || $('confirm-connection').hidden || !identity || !selected) return;
    const publicKey = Uint8Array.from(atob(request.publicKey.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('spki', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(saved.token)));
    const ciphertext = btoa(String.fromCharCode(...encrypted)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    connectionRequest = await api(`/${request.id}/confirm`, { spaceId: selected.id, ciphertext }, 'POST', saved.token, '/api/runweft/connect');
    renderConnection(); notice('已确认连接，凭据已加密交给该环境。让 Agent 完成本机保存即可。');
});
window.addEventListener('hashchange', () => { void action(refreshConnection); });

form('create-identity', async () => {
    // Probe storage before allocating an identity. Never replay a failed create automatically.
    persist();
    const result = await api('/identities', { name: input('new-name').value }, 'POST', '');
    saved = { token: result.token, spaceId: result.personalSpace.id };
    showSecret(result.token, 'identity'); persist(); await refresh();
});
form('import-identity', async () => {
    const token = input('import-token').value.trim();
    if (!/^rw_id_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('请输入这个 Hub 的 Runweft 身份 token（rw_id_ 开头）。');
    await api('/identity', undefined, 'GET', token);
    saved = { token }; persist(); input('import-token').value = ''; await refresh(); notice('已进入原身份。');
});
form('rename-identity', async () => { await api('/identity', { name: input('identity-name-input').value }, 'PATCH'); await refresh(); notice('显示名称已更新。'); });
form('create-space', async () => { const result = await api('/spaces', { name: input('new-space-name').value }); saved.spaceId = result.space.id; input('new-space-name').value = ''; persist(); await refresh(); });
form('rename-space', async () => { await api(`/spaces/${selected!.id}`, { name: input('space-name-input').value }, 'PATCH'); await refresh(); notice('空间名称已更新。'); });
form('accept-invitation', async () => { const result = await api('/invitations/accept', { token: input('invitation-token').value.trim() }); saved.spaceId = result.space.id; persist(); input('invitation-token').value = ''; await refresh(); notice('已加入空间。'); });
form('create-invitation', async () => { const result = await api(`/spaces/${selected!.id}/invitations`, { role: $<HTMLSelectElement>('invitation-role').value }); showSecret(result.token, 'invitation'); await refresh(); });
click('refresh', refresh);
click('backup-token', async () => { showSecret(saved.token, 'identity'); });
click('rotate-token', async () => { saved.pendingToken = newToken(); persist(); showSecret(saved.pendingToken, 'rotation'); });
click('apply-rotation', async () => {
    if (secretKind !== 'rotation' || !saved.pendingToken) return;
    const next = saved.pendingToken;
    try { await api('/identity/rotate', { token: next }); saved.token = next; delete saved.pendingToken; persist(); }
    catch {
        await recover();
        if (saved.token !== next) throw new Error('轮换未生效，原 token 仍可使用。需要更换时请重新生成并保存。');
    }
    showSecret(saved.token, 'identity'); await refresh(); notice('token 已更换。其他设备请导入新 token。');
});
click('leave-space', async () => {
    if (!await confirm(`退出 ${selected!.name}？之后需要新的邀请才能加入。`)) return;
    await api(`/spaces/${selected!.id}/members/${identity!.id}`, undefined, 'DELETE'); delete saved.spaceId; persist(); await refresh(); notice('已退出空间。');
});
click('logout', async () => {
    sessionStorage.removeItem(storageKey); saved = { token: '' }; secret = ''; $('secret-value').textContent = '';
    if (secretDialog.open) secretDialog.close(); showEntry(); notice('已退出此浏览器。服务器上的身份和空间仍保留。');
});
// Dialog controls remain usable without joining a pending network action.
$('close-secret').addEventListener('click', () => secretDialog.close());
secretDialog.addEventListener('close', () => { secret = ''; $('secret-value').textContent = ''; });
$('copy-secret').addEventListener('click', () => {
    if (!secret) return;
    void (async () => {
        try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(secret); $('secret-status').textContent = '已复制，请自行保存。'; }
        catch { const range = document.createRange(); range.selectNodeContents($('secret-value')); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); $('secret-status').textContent = '当前浏览器无法自动复制。已选中文本，可手动复制或下载备份。'; }
    })();
});
$('download-secret').addEventListener('click', () => {
    if (!secret) return;
    const content = `Runweft Hub: ${location.origin}\n${secretKind === 'invitation' ? '空间邀请' : `身份 ID: ${identity?.id ?? ''}`}\n${secret}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = secretKind === 'invitation' ? 'runweft-invitation.txt' : 'runweft-identity.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('secret-status').textContent = '已发起下载，请保留备份文件。';
});
$('host').textContent = location.host;
void action(async () => {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) { try { saved = JSON.parse(raw); } catch { throw new Error('此浏览器保存的身份信息损坏，请重新导入 token。'); } }
    if (!saved || typeof saved.token !== 'string') { saved = { token: '' }; throw new Error('请重新导入已保存的身份 token。'); }
    if (saved.token) { await recover(); await refresh(); } else await refreshConnection();
});
