import './forms.js';
import { mountConsole, element, control } from './ui/console.js';
import { createDemo } from './mock.js';
import { connectPreview } from '../../../.agents/skills/spec-trail/prototype/scripts/bridge.mjs';
const $ = id => document.getElementById(id);
let demo = createDemo();
demo.state.signedIn = document.body.dataset.entry !== 'identity';
function notice(message, error = false) { $('notice').textContent = message; $('notice').hidden = false; $('notice').dataset.error = String(error); }
async function action(fn) { try { await fn(); } catch (error) { notice(error.message, true); } }
function confirm(message) {
  const dialog = $('confirm-dialog'); $('confirm-description').textContent = message;
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.showModal(); });
}
function secret(title, value) { $('secret-title').textContent = title; $('secret-description').textContent = '仅为演示，不具有任何身份或连接权限。'; $('secret-value').textContent = value; $('secret-status').textContent = ''; $('secret-dialog').showModal(); }
$('close-secret').onclick = () => $('secret-dialog').close();
// Clipboard and downloads require permissions absent from the workbench sandbox.
$('copy-secret').hidden = true; $('download-secret').hidden = true;
function context() {
  return { userId: demo.state.user.userId, spaceId: demo.state.spaceId, members: demo.getMembers(), spaces: demo.state.spaces, request: demo.request, action, notice, confirm,
    openNative: async (_, files) => secret(files ? '原生文件 · 演示' : '原生详情 / 审批 · 演示', files ? 'review.md · 示例审阅报告' : '示例会话：等待审批\n实际产品在原生 HAPI 页面中处理。') };
}
function members() {
  $('members').replaceChildren(...demo.getMembers().map(member => {
    const row = element('tr'), ops = element('td'); row.append(element('td', `${member.name} · ${member.userId}`), element('td', { owner: '所有者', admin: '管理员', member: '成员' }[member.role]), ops);
    if (member.role !== 'owner') {
      ops.append(control(member.role === 'admin' ? '设为成员' : '设为管理员', async () => { member.role = member.role === 'admin' ? 'member' : 'admin'; await render(); }, context()));
      ops.append(control('移除成员', async () => { if (await confirm(`移除 ${member.name}？`)) { const rows = demo.getMembers(); rows.splice(rows.indexOf(member), 1); await render(); } }, context(), 'quiet'));
    } return row;
  }));
  $('member-count').textContent = String(demo.getMembers().length);
  $('invitations').replaceChildren(...demo.getInvitations().map(invite => {
    const row = element('p', `演示邀请 · ${invite.role === 'admin' ? '管理员' : '成员'} · ${invite.id} `);
    row.append(control('撤销邀请', async () => { const rows = demo.getInvitations(); rows.splice(rows.indexOf(invite), 1); await render(); }, context(), 'quiet')); return row;
  }));
}
async function render() {
  const { state } = demo;
  $('host').textContent = '演示空间'; $('entry').hidden = state.signedIn; $('workspace').hidden = !state.signedIn; $('logout').hidden = !state.signedIn;
  $('headline').textContent = state.signedIn ? '资源与协作' : '从你的身份开始';
  $('intro').textContent = state.signedIn ? '在你的空间中管理资源、查看执行与协作配置。' : '输入任意显示名称创建演示身份，或用 demo 体验导入。';
  if (!state.signedIn) return;
  $('identity-name').textContent = state.user.name; $('identity-id').textContent = state.user.userId; $('identity-name-input').value = state.user.name;
  const space = state.spaces.find(s => s.id === state.spaceId);
  $('spaces').replaceChildren(...state.spaces.map(s => { const button = control(s.name, async () => { state.spaceId = s.id; await render(); }, context()); button.setAttribute('aria-current', s.id === state.spaceId ? 'page' : 'false'); return button; }));
  $('space-name').textContent = space.name; $('space-id').textContent = space.id; $('space-role').textContent = '所有者'; $('space-name-input').value = space.name;
  $('rename-space').hidden = false; $('invitation-manager').hidden = false;
  members(); await mountConsole(context());
}
function form(id, fn) { $(id).addEventListener('submit', e => { e.preventDefault(); void action(fn); }); }
form('create-identity', async () => { demo = createDemo(); demo.state.user.name = $('new-name').value.trim() || '演示成员'; demo.state.signedIn = true; await render(); secret('演示身份已创建', 'demo'); });
form('import-identity', async () => { if ($('import-token').value !== 'demo') throw new Error('请使用演示 token：demo。不要输入真实凭据。'); demo.state.signedIn = true; $('import-token').value = ''; await render(); });
form('rename-identity', async () => { demo.state.user.name = $('identity-name-input').value.trim(); const self = demo.getMembers().find(m => m.userId === demo.state.user.userId); if (self) self.name = demo.state.user.name; await render(); notice('显示名称已更新。'); });
form('create-space', async () => { const space = { id: demo.nextId('space'), name: $('new-space-name').value.trim() }; demo.state.spaces.push(space); demo.state.spaceId = space.id; $('new-space-name').value = ''; await render(); notice('演示空间已创建。'); });
form('accept-invitation', async () => { if ($('invitation-token').value !== 'demo') throw new Error('演示邀请 token 为 demo。'); const space = { id: demo.nextId('space'), name: '受邀演示空间' }; demo.state.spaces.push(space); demo.state.spaceId = space.id; $('invitation-token').value = ''; await render(); notice('已加入演示空间。'); });
form('rename-space', async () => { demo.state.spaces.find(s => s.id === demo.state.spaceId).name = $('space-name-input').value.trim(); await render(); notice('空间名称已更新。'); });
form('create-invitation', async () => { const invite = { id: demo.nextId('invite'), role: $('invitation-role').value }; demo.getInvitations().push(invite); members(); secret('演示邀请', 'demo'); });
$('backup-token').onclick = () => secret('备份演示 token', 'demo');
$('rotate-token').onclick = () => void action(async () => { if (await confirm('体验更换 token？原型仅展示确认流程。')) secret('演示 token 已更换', 'demo'); });
$('leave-space').onclick = () => notice('你是最后一位所有者；需要先指定另一位所有者。', true);
$('logout').onclick = () => void action(async () => { demo.state.signedIn = false; await render(); });
$('refresh').onclick = () => void action(render);
$('demo-scenario').onchange = () => void action(async () => { demo.state.scenario = $('demo-scenario').value; $('notice').hidden = true; await render(); });
$('demo-reset').onclick = () => { location.reload(); };
// The immutable hosting path is the protocol version; local previews use a local marker.
const version = location.pathname.match(/^\/runweft\/([^/]+)\//)?.[1] || 'local-preview';
async function init() {
try { await render(); connectPreview({ version }); document.body.dataset.ready = 'true'; }
catch (error) { notice(error.message, true); connectPreview({ version, status: 'error', message: error.message }); }

}
void init();
