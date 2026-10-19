import { h, icon, mark } from '../ui/dom.js';
import { banner, button, field, select } from '../ui/kit.js';

const request = { hub: 'hub.example.com', device: '林舟的 MacBook Pro', code: '8F2C 61A9' };

// Scenes: register / login (both carry a CLI connection request), signin (plain), authorized, expired-request, recover.
export function renderAccount(ctx) {
  const scene = ctx.app.scene;
  const connecting = ['register', 'login', 'authorized', 'expired-request'].includes(scene);
  const card = h('section', { class: 'auth-card', 'aria-labelledby': 'auth-title' });
  const error = h('div', { class: 'auth-error' });
  const fail = e => error.replaceChildren(banner('danger', e.message, e.hint));
  const notice = ctx.app.notice?.title ? banner(ctx.app.notice.tone, ctx.app.notice.title, ctx.app.notice.text) : null;

  if (scene === 'register' || scene === 'login' || scene === 'signin') {
    const register = scene === 'register';
    const username = field('用户名', { required: true, autocomplete: 'username', spellcheck: false, hint: register ? '用于登录，不能与已有用户名重复。' : '使用你在这个 Hub 注册的用户名。' });
    const password = field('密码', { type: 'password', required: true, autocomplete: register ? 'new-password' : 'current-password', hint: '支持粘贴和密码管理器。' });
    if (!register) username.input.value = 'linzhou';
    const space = scene === 'login' ? select('连接后默认使用的空间', [{ value: 'space-7c21', label: '产品协作' }, { value: 'space-a903', label: '个人实验' }], 'space-7c21', { hint: '你在多个空间里。这个环境发起的委派默认进入所选空间。' }) : null;
    const submitLabel = register ? '注册并连接' : scene === 'login' ? '登录并连接' : '登录';
    const formNode = h('form', { class: 'form' }, username.node, password.node, space?.node ?? null, error,
      h('div', { class: 'form-actions stretch' }, button(submitLabel, { type: 'submit', variant: 'primary', size: 'lg' })));
    formNode.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        if (register) { await ctx.api.register(username.input.value); ctx.setScene('authorized', { first: true }); }
        else { await ctx.api.login(username.input.value); if (scene === 'login') ctx.setScene('authorized'); else ctx.signedIn(); }
      } catch (e) { fail(e); }
    });
    card.append(
      h('p', { class: 'auth-eyebrow', text: connecting ? '连接你的工作环境' : 'Runweft Hub' }),
      h('h1', { id: 'auth-title', tabIndex: -1, text: register ? '第一次使用 Runweft' : '欢迎回来' }),
      h('p', { class: 'auth-intro', text: register ? '创建账号并连接，Agent 会继续准备你的第一次体验。' : scene === 'login' ? '登录后，把当前工作环境连接到你的账号。' : '用账号密码回到你的空间。' }),
      ...(notice ? [notice] : []), formNode,
      h('div', { class: 'auth-links' },
        scene !== 'register' ? button('忘记密码？', { variant: 'link', onClick: () => ctx.setScene('recover') }) : null,
        connecting ? button(register ? '已有账号？登录' : '没有账号？注册', { variant: 'link', onClick: () => ctx.setScene(register ? 'login' : 'register') }) : null),
      h('p', { class: 'auth-foot', text: register ? '显示名称默认使用用户名，并自动创建你的空间。' : '只退出当前浏览器不会断开已连接的命令行环境。' }));
  } else if (scene === 'authorized') {
    const first = !!ctx.app.notice?.first;
    card.append(
      h('p', { class: 'auth-eyebrow ok' }, icon('st-done'), '已授权'),
      h('h1', { id: 'auth-title', tabIndex: -1, text: '可以返回原对话了' }),
      h('p', { class: 'auth-intro', text: 'Agent 会继续完成接入，并把第一份评审报告带回原对话。不需要再发送“已经点好”。' }),
      banner('info', '本机是否连接完成、执行工具是否就绪，由 Agent 核对后告诉你。', ''),
      h('div', { class: 'form-actions stretch' }, button('查看工作台', { variant: 'secondary', size: 'lg', onClick: () => ctx.signedIn('tasks') })),
      h('p', { class: 'auth-foot', text: first ? '你的账号和“我的空间”已经创建好。也可以直接关闭这个标签页。' : '也可以直接关闭这个标签页。' }));
  } else if (scene === 'expired-request') {
    card.append(
      h('p', { class: 'auth-eyebrow', text: '连接你的工作环境' }),
      h('h1', { id: 'auth-title', tabIndex: -1, text: '这个连接请求已过期' }),
      h('p', { class: 'auth-intro', text: '回到原对话，让 Agent 重新给出连接链接。已有账号会保留，不需要重新注册。' }),
      banner('warn', '这次请求没有获得授权', ''),
      h('div', { class: 'form-actions stretch' }, button('用账号登录', { variant: 'secondary', size: 'lg', onClick: () => ctx.setScene('signin') })));
  } else if (scene === 'recover') {
    const username = field('用户名', { required: true, autocomplete: 'username', value: 'linzhou' });
    const code = field('一次性重置码', { type: 'password', required: true, autocomplete: 'off', hint: '由这个 Hub 的部署者提供，只用于这一次。演示中输入 demo。' });
    const password = field('新密码', { type: 'password', required: true, autocomplete: 'new-password' });
    const formNode = h('form', { class: 'form' }, username.node, code.node, password.node, error, h('div', { class: 'form-actions stretch' }, button('重置密码', { type: 'submit', variant: 'primary', size: 'lg' })));
    formNode.addEventListener('submit', async event => {
      event.preventDefault();
      try { await ctx.api.resetPassword(username.input.value, code.input.value); ctx.setScene('signin', { tone: 'ok', title: '密码已更新', text: '请使用新密码登录。' }); } catch (e) { fail(e); }
    });
    card.append(
      h('p', { class: 'auth-eyebrow', text: '找回账号' }),
      h('h1', { id: 'auth-title', tabIndex: -1, text: '重置密码' }),
      h('p', { class: 'auth-intro', text: '请联系这个 Hub 的部署者获取一次性重置码，再设置新密码。' }),
      formNode, h('div', { class: 'auth-links' }, button('返回登录', { variant: 'link', onClick: () => ctx.setScene('signin') })));
  }

  const side = connecting ? h('aside', { class: 'auth-side glass', 'aria-label': '核对连接请求' },
    h('h2', { text: scene === 'expired-request' ? '已过期的连接请求' : '核对连接请求' }),
    h('dl', { class: 'verify' },
      h('div', {}, h('dt', { text: 'Hub' }), h('dd', { class: 'mono', text: request.hub })),
      h('div', {}, h('dt', { text: '工作环境' }), h('dd', { text: request.device })),
      h('div', { class: 'verify-code' }, h('dt', { text: '核对码' }), h('dd', { class: 'mono', text: request.code }))),
    h('p', { class: 'hint', text: '请与 Agent 给出的地址、设备和核对码核对。连接后，这个命令行环境能以你的账号访问有权使用的资源；可以随时在账号设置中断开。' }),
    h('ol', { class: 'steps' },
      h('li', { dataset: { done: String(scene === 'authorized') } }, h('span', { class: 'step-knot', 'aria-hidden': 'true' }), '用账号授权这个环境'),
      h('li', {}, h('span', { class: 'step-knot', 'aria-hidden': 'true' }), 'Agent 准备机器和执行工具'),
      h('li', {}, h('span', { class: 'step-knot', 'aria-hidden': 'true' }), '在原对话读到第一份评审报告'))) : null;

  return h('div', { class: 'auth' },
    h('header', { class: 'auth-brand' }, mark(), h('span', { class: 'brand-name', text: 'Runweft' }), h('span', { class: 'brand-tag', text: 'Hub' })),
    h('main', { class: `auth-grid${side ? '' : ' single'}`, id: 'page', tabIndex: -1 }, card, side));
}
