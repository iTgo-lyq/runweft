import { clearConsole, mountConsole } from './console.js';
export default '';
type Identity = { id: string; name: string; createdAt: number };
type Role = 'owner' | 'admin' | 'member';
type Space = { id: string; name: string; role: Role };
type Member = { userId: string; name: string; role: Role };
type Invitation = { id: string; role: 'admin' | 'member'; expiresAt: number };
type Saved = { token: string; spaceId?: string };
const storageKey = 'runweft.hub.session', labels = { owner: '所有者', admin: '管理员', member: '成员' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const secretDialog = $<HTMLDialogElement>('secret-dialog'), confirmDialog = $<HTMLDialogElement>('confirm-dialog');
let saved: Saved = { token: '' }, identity: Identity | undefined, spaces: Space[] = [], selected: Space | undefined;
let busy = false, secret = '';
let authMode: 'register'|'login' = new URLSearchParams(location.hash.slice(1)).has('connect') ? 'register' : 'login';
let connectionError = '';
let pendingLocation = false;
type ConnectionRequest = { id: string; origin: string; label: string; code: string; expiresAt: number; status: string };
let connectionRequest: ConnectionRequest | undefined;
const domainTokens = new Map<string, { token: string; expiresAt: number }>();
class ApiError extends Error { constructor(readonly status: number, message: string, readonly code?:string) { super(message); } }

function notice(message: string, error = false) {
    $('notice').textContent = message; $('notice').hidden = !message; $('notice').dataset.error = String(error);
}
function persist() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch { throw new Error('浏览器无法保存当前身份。请允许此站点使用会话存储，再用账号密码登录。'); }
}
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token = saved.token, base = '/api/runweft/hub'): Promise<any> {
    let response: Response;
    try { response = await fetch(`${base}${path}`, { method, credentials: 'omit', redirect: 'error', headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ApiError(0, '无法连接 Hub。写操作的结果可能尚未确认，请先刷新核对，不要重复提交。'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, [data.error?.message ?? '请求未能完成。', data.error?.hint].filter(Boolean).join(' '),data.error?.code);
    return data;
}
async function action(fn: () => Promise<void>) {
    if (busy) return;
    busy = true; notice('');
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea'));
    const disabled = controls.map(node => node.disabled);
    controls.forEach(node => { node.disabled = true; });
    try { await fn(); }
    catch (error) {
        if (error instanceof ApiError && error.status === 401 && error.code==='user_session_invalid') {authMode='login';showEntry();}
        const message = error instanceof Error ? error.message : '操作未能完成，请刷新核对。';
        notice(message, true);
        if (secretDialog.open) $('secret-status').textContent = message;
    } finally {
        controls.forEach((node, i) => { if (node.isConnected) node.disabled = disabled[i]; }); busy = false;
        if(pendingLocation)void refreshLocation();
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
function showEntry() {
    domainTokens.clear(); clearConsole();
    identity = undefined; selected = undefined; spaces = [];
    $('entry').hidden = false; $('workspace').hidden = true; $('logout').hidden = true;
    $('connection-success').hidden = true; $('account-settings').hidden = true;
    $('auth-form').hidden=false;$('reset-form').hidden=true;$('toggle-auth').hidden=false;$('forgot-password').hidden=false;document.querySelector<HTMLElement>('.account-panel')!.hidden=false;
    $('headline').textContent = '连接你的工作环境'; $('intro').textContent = '用账号登录，让 Agent 继续准备你的第一次体验。';
    renderAuth();
    for (const id of ['identity-name', 'identity-id', 'space-name', 'space-id', 'members', 'invitations', 'spaces']) $(id).replaceChildren();
    renderConnection();
}
let renderedIdentityToken = '';
async function refresh() {
    if (renderedIdentityToken !== saved.token || (selected && selected.id !== saved.spaceId)) clearConsole();
    domainTokens.clear();
    identity = (await api('/identity')).identity;
    spaces = (await api('/spaces')).spaces;
    $('entry').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('connection-success').hidden = true; $('account-settings').hidden = true;
    $('headline').textContent = '资源与协作'; $('intro').textContent = '机器 → Runtime → Agent → 任务。配置属于 Hub，执行留在你选择的机器。';
    $('identity-name').textContent = identity!.name; $('identity-id').textContent = identity!.id; input('identity-name-input').value = identity!.name;
    const previousSpaceId = selected?.id;
    const targetSpace=new URLSearchParams(location.hash.slice(1)).get('space');
    selected = targetSpace ? spaces.find(space=>space.id===targetSpace) : spaces.find(space => space.id === saved.spaceId) ?? spaces[0];
    if(targetSpace&&!selected){clearConsole();$('workspace').hidden=true;throw new Error('此链接的空间不可访问，请返回 /hub 选择有权访问的空间。');}
    if (previousSpaceId !== selected?.id) clearConsole();
    saved.spaceId = selected?.id; persist();
    await refreshConnection();
    if(connectionRequest?.status==='pending'||connectionError){ $('entry').hidden=false; document.querySelector<HTMLElement>('.account-panel')!.hidden=true; $('workspace').hidden=true; return; }
    $('spaces').replaceChildren(...spaces.map(space => {
        const node = button('', async () => { const query=new URLSearchParams(location.hash.slice(1));for(const key of ['task','round','space'])query.delete(key);history.replaceState(null,'','/hub'+(query.size?'#'+query:''));saved.spaceId = space.id; persist(); await refresh(); });
        node.append(text('span', space.name), text('span', labels[space.role]));
        if (space.id === selected?.id) node.setAttribute('aria-current', 'page'); return node;
    }));
    const section = document.querySelector<HTMLElement>('.space-content')!;
    section.hidden = !selected;
    if (!selected) return;
    const space = selected, route = `/spaces/${encodeURIComponent(space.id)}`;
    $('space-name').textContent = space.name; $('space-id').textContent = space.id; $('space-role').textContent = `当前角色 · ${labels[space.role]}`;
    input('space-name-input').value = space.name;
    const permissions = (await api(route + '/permissions')).permissions;
    const manage = permissions.manageInvitations; $('rename-space').hidden = !permissions.rename; $('invitation-manager').hidden = !manage;
    $('leave-space').hidden = !permissions.leave;
    const roleSelect = $<HTMLSelectElement>('invitation-role');
    roleSelect.replaceChildren(...permissions.inviteRoles.map((role: Role) => new Option(labels[role], role)));
    $('members').replaceChildren(); $('invitations').replaceChildren();
    const [members, invitations] = await Promise.all([api(route + '/members'), manage ? api(route + '/invitations') : Promise.resolve({ invitations: [] })]);
    $('member-count').textContent = String(members.members.length);
    $('members').replaceChildren(...members.members.map((member: Member) => {
        const row = document.createElement('tr'), name = document.createElement('td'), role = document.createElement('td'), actions = document.createElement('td');
        name.append(text('span', member.name + (member.userId === identity!.id ? '（你）' : '')), text('code', member.userId));
        role.textContent = labels[member.role];
        const group = text('div', '', 'member-actions');
        const memberPermissions = permissions.members[member.userId];
        if (memberPermissions.roles.length > 1) {
            const select = document.createElement('select'); select.setAttribute('aria-label', `${member.name}的角色`);
            for (const value of memberPermissions.roles as Role[]) select.add(new Option(labels[value], value));
            select.value = member.role;
            group.append(select, button('保存', async () => {
                if (select.value === member.role) return;
                if (!await confirm(`将 ${member.name} 的角色改为${labels[select.value as Role]}？`)) return;
                await api(route + `/members/${member.userId}`, { role: select.value }, 'PATCH'); await refresh(); notice('成员角色已更新。');
            }));
        }
        if (memberPermissions.remove && member.userId !== identity!.id) group.append(button('移除', async () => {
            if (!await confirm(`将 ${member.name} 移出 ${space.name}？`)) return;
            await api(route + `/members/${member.userId}`, undefined, 'DELETE'); await refresh(); notice('成员已移除。');
        }, 'quiet'));
        actions.append(group); row.append(name, role, actions); return row;
    }));
    if (manage) $('invitations').replaceChildren(...(invitations.invitations.length ? invitations.invitations.map((invite: Invitation) => {
        const node = text('div', '', 'invitation');
        node.append(text('span', `${labels[invite.role]}邀请 · ${new Date(invite.expiresAt).toLocaleString('zh-CN')} 到期`));
        if (permissions.invitations[invite.id]?.revoke) node.append(button('撤销', async () => {
            await api(route + `/invitations/${invite.id}`, undefined, 'DELETE'); await refresh(); notice('邀请已撤销。');
        }, 'quiet'));
        return node;
    }) : [text('p', '没有待使用的邀请。', 'hint')]));
    const currentToken = saved.token, currentSpace = space.id;
    renderedIdentityToken = saved.token;
    await mountConsole({ userId: identity!.id, spaceId: space.id, members: members.members, spaces, action, confirm, notice,
        openNative: async (sessionId, files = false) => {
            if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('无效原生会话 ID。');
            const tab = window.open('about:blank', '_blank');
            if (!tab) throw new Error('浏览器阻止了新标签页。允许此 Hub 打开弹窗后重试。');
            try {
                tab.sessionStorage.removeItem(storageKey); tab.sessionStorage.removeItem('runweft.native.access'); tab.opener = null;
                tab.document.title = '正在打开受限会话';
                tab.document.body.textContent = '正在核对当前空间的会话访问权限…';
                const auth = await api('/auth', { accessToken: currentToken, spaceId: currentSpace }, 'POST', '', '/api');
                await api(`/sessions/${sessionId}`, undefined, 'GET', auth.token, '/api');
                if (saved.token !== currentToken || selected?.id !== currentSpace) throw new Error('身份或空间已变化，请重新打开。');
                tab.sessionStorage.setItem('runweft.native.access', auth.token);
                tab.location.replace(`/sessions/${sessionId}${files ? '/files' : ''}`);
            } catch (error) { tab.close(); throw error; }
        },
        request: async (path, body, method = body === undefined ? 'GET' : 'POST', global = false) => {
            if (saved.token !== currentToken || selected?.id !== currentSpace) throw new Error('当前身份或空间已变化，请刷新。');
            const key = global ? 'global' : currentSpace;
            let credential = domainTokens.get(key);
            if (!credential || credential.expiresAt < Date.now() + 30_000) {
                const auth = await api('/auth', { accessToken: currentToken, ...(global ? {} : { spaceId: currentSpace }) }, 'POST', '', '/api');
                credential = { token: auth.token, expiresAt: Date.now() + 14 * 60_000 }; domainTokens.set(key, credential);
            }
            const result = await api(path, body, method, credential.token, '/api/runweft');
            if (saved.token !== currentToken || selected?.id !== currentSpace) throw new Error('当前身份或空间已变化，请刷新。');
            return result;
        },
    });
}
function confirm(message: string): Promise<boolean> {
    $('confirm-description').textContent = message; confirmDialog.returnValue = '';
    // The dialog controls are enabled even while the initiating action is pending.
    confirmDialog.querySelectorAll('button').forEach(node => { node.disabled = false; });
    confirmDialog.showModal();
    return new Promise(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'yes'), { once: true }));
}
function showSecret(value: string, _kind: 'invitation') {
    secret=value;$('secret-value').textContent=value;$('secret-status').textContent='';
    $('secret-title').textContent='分享这个空间邀请';$('secret-description').textContent='把邀请交给希望加入的成员，24 小时内仅能由一人使用。';
    if(!secretDialog.open)secretDialog.showModal();
}
function renderAuth() {
    const connecting=connectionRequest?.status==='pending';
    $('auth-title').textContent=authMode==='register'?'第一次使用 Runweft':'欢迎回来';
    $('auth-description').textContent=authMode==='register'?'创建账号，自动准备你的默认空间。':'用账号密码回到你的空间。';
    $('auth-submit').textContent=(authMode==='register'?'注册':'登录')+(connecting?'并连接':'');
    input('account-password').autocomplete=authMode==='register'?'new-password':'current-password';
    $('toggle-auth').textContent=authMode==='register'?'已有账号？登录':'没有账号？注册';
}
function showAuthorized(){
    $('entry').hidden=true;$('workspace').hidden=true;$('account-settings').hidden=true;$('connection-success').hidden=false;
}
function renderConnection(){
    const request=connectionRequest,id=new URLSearchParams(location.hash.slice(1)).get('connect');
    $('entry').dataset.connect=String(!!id);$('entry').dataset.authenticated=String(!!identity);$('connect-request').hidden=!id;$('confirm-connection').hidden=true;$('connect-space-label').hidden=true;
    if(!id){renderAuth();return;}
    $('connect-details').textContent=request?`Hub：${request.origin} · 工作环境：${request.label}`:'';
    $('connect-code').textContent=request?.code??'';
    $('connect-identity').textContent=identity?`当前账号：${identity.name}`:'';
    $('connect-status').textContent=connectionError||(request?.status==='confirmed'?'已授权。CLI 会继续校验并保存连接。':request?'核对设备和代码后连接。':'正在读取连接信息…');
    if(request?.status==='pending'&&identity&&selected){
        $('confirm-connection').hidden=false;
        const chooser=$<HTMLSelectElement>('connect-space');chooser.replaceChildren(...spaces.map(space=>new Option(space.name,space.id)));chooser.value=selected.id;
        $('connect-space-label').hidden=spaces.length<2;
    }
    $('leave-connection').hidden=!connectionError;
    if(connectionError)document.querySelector<HTMLElement>('.account-panel')!.hidden=true;
    renderAuth();
}
async function refreshConnection(){
    const id=new URLSearchParams(location.hash.slice(1)).get('connect');connectionError='';
    if(!id){connectionRequest=undefined;renderConnection();return;}
    try{connectionRequest=await api(`/${id}`,undefined,'GET','','/api/runweft/connect');}
    catch(error){connectionRequest=undefined;connectionError=error instanceof Error?error.message:'连接信息不可用，请回到原对话核对。';}
    renderConnection();
}
async function confirmConnection(){
    if(!connectionRequest||connectionRequest.status!=='pending'||!identity||!selected)return;
    const spaceId=$<HTMLSelectElement>('connect-space').value||selected.id;
    const requestId=connectionRequest.id;
    try{connectionRequest=await api(`/${requestId}/confirm`,{spaceId},'POST',saved.token,'/api/runweft/connect');}
    catch(error){await refreshConnection();if(connectionRequest?.id!==requestId||connectionRequest?.status!=='confirmed')throw error;}
    renderConnection();showAuthorized();
}
click('confirm-connection',confirmConnection);
click('leave-connection',async()=>{history.replaceState(null,'','/hub');authMode='login';connectionRequest=undefined;connectionError='';if(saved.token)await refresh();else{showEntry();await refreshConnection();}});
click('view-workspace',async()=>{if(saved.token)await refresh();else showEntry();});
$('toggle-auth').addEventListener('click',()=>{authMode=authMode==='register'?'login':'register';renderAuth();});
$('forgot-password').addEventListener('click',()=>{$('auth-form').hidden=true;$('reset-form').hidden=false;$('toggle-auth').hidden=true;$('forgot-password').hidden=true;input('reset-username').value=input('account-username').value;input('reset-username').focus();});
$('back-login').addEventListener('click',()=>{$('auth-form').hidden=false;$('reset-form').hidden=true;$('toggle-auth').hidden=false;$('forgot-password').hidden=false;authMode='login';renderAuth();});
for(const toggle of document.querySelectorAll<HTMLButtonElement>('[data-password]'))toggle.addEventListener('click',()=>{
    const field=input(toggle.dataset.password!);field.type=field.type==='password'?'text':'password';toggle.textContent=field.type==='password'?'显示':'隐藏';toggle.setAttribute('aria-label',(field.type==='password'?'显示':'隐藏')+(toggle.dataset.passwordLabel??'密码'));
});
form('auth-form',async()=>{
    sessionStorage.setItem(storageKey,JSON.stringify(saved));const preferred=saved.spaceId;
    const value=await api(authMode==='register'?'/accounts':'/sessions',{username:input('account-username').value,password:input('account-password').value},'POST','');
    saved={token:value.token};persist();input('account-password').value='';await refresh();
    if(connectionRequest?.status==='pending'&&(spaces.length===1||spaces.some(space=>space.id===preferred))){
        if(preferred&&spaces.some(space=>space.id===preferred))$<HTMLSelectElement>('connect-space').value=preferred;
        await confirmConnection();
    }else if(connectionRequest?.status==='pending'){$('entry').hidden=false;$('auth-form').hidden=true;$('toggle-auth').hidden=true;$('forgot-password').hidden=true;$('workspace').hidden=true;renderConnection();}
});
form('reset-form',async()=>{
    await api('/account/password-reset',{username:input('reset-username').value,code:input('reset-code').value,password:input('reset-password').value},'POST','');
    input('reset-code').value='';input('reset-password').value='';saved={token:''};persist();authMode='login';showEntry();notice('密码已更新，请使用新密码登录。');
});
async function settings(){
    const [account,value]=await Promise.all([api('/account'),api('/credentials')]);
    $('entry').hidden=true;$('workspace').hidden=true;$('connection-success').hidden=true;$('account-settings').hidden=false;
    $('settings-username').textContent=`用户名：${account.username}`;
    $('credentials-list').replaceChildren(...value.credentials.map((credential:any)=>{
        const row=document.createElement('div');row.className='credential-row';row.dataset.credentialId=credential.id;
        row.append(text('strong',credential.label+(credential.id===value.currentCredentialId?'（当前环境）':'')),text('span',`${credential.kind==='cli'?'命令行':'浏览器'} · ${credential.active?'可用':'已撤销或到期'} · 最近使用：${new Date(credential.lastUsedAt).toLocaleString('zh-CN')}`));
        if(credential.active)row.append(button('断开环境',async()=>{
            if(!await confirm('断开这个登录环境？已接受的任务会继续执行。'))return;
            await api('/credentials/'+credential.id,undefined,'DELETE');
            if(credential.id===value.currentCredentialId){saved={token:''};persist();authMode='login';showEntry();}else await settings();
        }));return row;
    }));
}
click('show-settings',settings);click('close-settings',refresh);
form('change-password',async()=>{
    await api('/account/password',{password:input('current-password').value,newPassword:input('next-password').value});
    input('current-password').value='';input('next-password').value='';saved={token:''};persist();authMode='login';showEntry();notice('密码已更新，请重新登录。');
});
form('logout-all-form',async()=>{
    await api('/credentials/revoke-all',{password:input('all-password').value});input('all-password').value='';saved={token:''};persist();authMode='login';showEntry();notice('所有用户登录环境已退出。');
});
form('rename-identity', async () => { await api('/identity', { name: input('identity-name-input').value }, 'PATCH'); await refresh(); notice('显示名称已更新。'); });
form('create-space', async () => { const result = await api('/spaces', { name: input('new-space-name').value }); saved.spaceId = result.space.id; input('new-space-name').value = ''; persist(); await refresh(); });
form('rename-space', async () => { await api(`/spaces/${selected!.id}`, { name: input('space-name-input').value }, 'PATCH'); await refresh(); notice('空间名称已更新。'); });
form('accept-invitation', async () => { const result = await api('/invitations/accept', { token: input('invitation-token').value.trim() }); saved.spaceId = result.space.id; persist(); input('invitation-token').value = ''; await refresh(); notice('已加入空间。'); });
form('create-invitation', async () => { const result = await api(`/spaces/${selected!.id}/invitations`, { role: $<HTMLSelectElement>('invitation-role').value }); showSecret(result.token, 'invitation'); await refresh(); });
click('refresh', refresh);
click('leave-space', async () => {
    if (!await confirm(`退出 ${selected!.name}？之后需要新的邀请才能加入。`)) return;
    await api(`/spaces/${selected!.id}/members/${identity!.id}`, undefined, 'DELETE'); delete saved.spaceId; persist(); await refresh(); notice('已退出空间。');
});
click('logout',async()=>{
    try{await api('/sessions/logout',{});}catch(error){if(!(error instanceof ApiError)||error.status!==401)throw error;}
    saved={token:''};sessionStorage.removeItem(storageKey);secret='';if(secretDialog.open)secretDialog.close();authMode='login';showEntry();notice('已退出当前浏览器，可用账号密码重新登录。');
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
    const content = `Runweft Hub: ${location.origin}\n空间邀请\n${secret}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'runweft-invitation.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('secret-status').textContent = '已发起下载，请保留备份文件。';
});
$('host').textContent = location.host;
void action(async()=>{
    const raw=sessionStorage.getItem(storageKey);
    if(raw){try{saved=JSON.parse(raw);}catch{throw new Error('当前会话记录无效，请重新登录。');}}
    if(!saved||typeof saved.token!=='string'){saved={token:''};throw new Error('请使用账号密码重新登录。');}
    renderAuth();await locationView();
    if(location.hash==='#native-expired')notice('原生页面的限时访问已失效。请在已登录的 Hub 中重新打开，或使用账号密码登录。',true);
});

async function locationView(){
    if(saved.token)await refresh();else{showEntry();await refreshConnection();}
    if(connectionRequest?.status==='confirmed')showAuthorized();
}
async function refreshLocation(){await action(async()=>{pendingLocation=false;await locationView();});}
window.addEventListener('hashchange',()=>{pendingLocation=true;if(!busy)void refreshLocation();});
