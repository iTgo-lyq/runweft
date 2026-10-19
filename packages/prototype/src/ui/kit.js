// Shared controls. Native elements keep their keyboard behaviour; overlays restore focus on close.
import { append, h, icon } from './dom.js';

let serial = 0;
const nextId = prefix => `${prefix}${++serial}`;

export function button(label, options = {}) {
  const { icon: name, variant = 'secondary', size, onClick, type = 'button', iconOnly = false, title, disabled, className = '', id } = options;
  const node = h('button', {
    type, id, disabled, class: `btn ${className}`.trim(), title: iconOnly ? (title ?? label) : title,
    'aria-label': iconOnly ? label : undefined, dataset: { variant, ...(size ? { size } : {}), ...(iconOnly ? { iconOnly: 'true' } : {}) },
  });
  if (name) node.append(icon(name));
  if (!iconOnly) node.append(h('span', { class: 'btn-label', text: label }));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export const tones = {
  info: 'info', ok: 'st-done', warn: 'st-attention', danger: 'st-failed', unknown: 'st-unknown', neutral: 'info', offline: 'wifi-off', lock: 'lock',
};

export function badge(tone, label, iconName = null) {
  return h('span', { class: 'badge', dataset: { tone } }, iconName ? icon(iconName) : null, h('span', { text: label }));
}

export const taskStatus = {
  needs_attention: { label: '需要处理', icon: 'st-attention', tone: 'warn' },
  unknown: { label: '执行未确认', icon: 'st-unknown', tone: 'unknown' },
  running: { label: '进行中', icon: 'st-running', tone: 'accent' },
  completed: { label: '已完成', icon: 'st-done', tone: 'ok' },
  failed: { label: '失败', icon: 'st-failed', tone: 'danger' },
  interrupted: { label: '已停止', icon: 'st-stopped', tone: 'neutral' },
};
export const statusBadge = status => badge(taskStatus[status].tone, taskStatus[status].label, taskStatus[status].icon);

export function banner(tone, title, text, actions = []) {
  return h('div', { class: 'banner', dataset: { tone }, role: tone === 'danger' ? 'alert' : 'status' },
    icon(tones[tone] ?? 'info'),
    h('div', { class: 'banner-text' }, h('strong', { text: title }), text ? h('p', { text }) : null),
    actions.length ? h('div', { class: 'banner-actions' }, actions) : null);
}

export function emptyState({ icon: name = 'info', title, text, actions = [], tone }) {
  return h('div', { class: 'empty', dataset: tone ? { tone } : undefined },
    h('div', { class: 'empty-glyph' }, icon(name)),
    h('h3', { text: title }), text ? h('p', { text }) : null,
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}

export function facts(rows) {
  return h('dl', { class: 'facts' }, rows.filter(Boolean).map(([label, value]) =>
    h('div', { class: 'fact' }, h('dt', { text: label }), h('dd', {}, value instanceof Node ? value : String(value ?? '—')))));
}

export const mono = (text, className = 'mono') => h('span', { class: className, text });

export function pageHead(title, description, actions = []) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-title' }, h('h1', { text: title, tabIndex: -1 }), description ? h('p', { class: 'page-desc', text: description }) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

export function section(title, ...children) {
  return h('section', { class: 'panel-section' }, title ? h('h3', { class: 'section-title', text: title }) : null, ...children);
}

export function field(label, options = {}) {
  const id = options.id ?? nextId('f');
  const hintId = options.hint ? `${id}-hint` : undefined;
  const input = options.multiline ? h('textarea', { id, rows: options.rows ?? 4 }) : h('input', { id, type: options.type ?? 'text' });
  if (options.value !== undefined) input.value = options.value;
  input.required = !!options.required;
  if (options.max) input.maxLength = options.max;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.autocomplete) input.setAttribute('autocomplete', options.autocomplete);
  if (options.name) input.name = options.name;
  if (options.mono) input.classList.add('mono-input');
  if (options.spellcheck === false) input.spellcheck = false;
  if (hintId) input.setAttribute('aria-describedby', hintId);
  let control = input;
  if (options.type === 'password') {
    const reveal = button('显示', { variant: 'quiet', size: 'sm', className: 'reveal' });
    reveal.setAttribute('aria-label', `显示${label}`);
    reveal.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      reveal.querySelector('.btn-label').textContent = show ? '隐藏' : '显示';
      reveal.setAttribute('aria-label', `${show ? '隐藏' : '显示'}${label}`);
    });
    control = h('div', { class: 'password' }, input, reveal);
  }
  const node = h('div', { class: 'field' }, h('label', { for: id, class: 'field-label', text: label }), control,
    options.hint ? h('p', { class: 'field-hint', id: hintId, text: options.hint }) : null);
  return { node, input };
}

export function select(label, choices, value = '', options = {}) {
  const id = nextId('f');
  const input = h('select', { id });
  for (const choice of choices) input.add(new Option(choice.label, choice.value));
  input.value = value;
  if (options.required) input.required = true;
  const node = h('div', { class: 'field' }, h('label', { for: id, class: 'field-label', text: label }),
    h('div', { class: 'select' }, input, icon('chevron-down')), options.hint ? h('p', { class: 'field-hint', text: options.hint }) : null);
  return { node, input };
}

// Sandboxed previews block native submission (requestSubmit included); validate, then dispatch locally.
export function submitForm(node) {
  if (node.reportValidity()) node.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

export function form(fields, submitLabel, onSubmit, { extra = [], cancel } = {}) {
  const submit = button(submitLabel, { type: 'submit', variant: 'primary' });
  const node = h('form', { class: 'form' }, fields, h('div', { class: 'form-actions' }, cancel ?? null, extra, submit));
  node.addEventListener('submit', event => { event.preventDefault(); onSubmit(); });
  return node;
}

export function switchRow({ label, description, checked, onChange, disabled }) {
  const id = nextId('s');
  const control = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!checked), 'aria-labelledby': `${id}-l`, 'aria-describedby': description ? `${id}-d` : undefined, disabled },
    h('span', { class: 'switch-thumb' }));
  control.addEventListener('click', () => onChange(control.getAttribute('aria-checked') !== 'true'));
  return h('div', { class: 'switch-row' },
    h('div', { class: 'switch-text' }, h('span', { id: `${id}-l`, class: 'switch-label', text: label }), description ? h('span', { id: `${id}-d`, class: 'switch-desc', text: description }) : null),
    control);
}

// Radio-style group with roving focus; also used for filter chips.
export function segmented(label, options, value, onChange, className = 'segmented') {
  const group = h('div', { class: className, role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(option => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(option.value === value), tabIndex: option.value === value ? 0 : -1, dataset: { value: option.value },
  }, option.icon ? icon(option.icon) : null, h('span', { text: option.label })));
  if (!buttons.some(b => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;
  const choose = (target, focus) => {
    for (const b of buttons) { const on = b === target; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    if (focus) target.focus();
    onChange(target.dataset.value);
  };
  buttons.forEach((b, index) => {
    b.addEventListener('click', () => choose(b, false));
    b.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      choose(buttons[(index + step + buttons.length) % buttons.length], true);
    });
  });
  group.append(...buttons);
  return group;
}

export function tabs(prefix, label, items, active, onSelect) {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const buttons = items.map(item => h('button', {
    type: 'button', role: 'tab', id: `${prefix}-tab-${item.id}`, 'aria-selected': String(item.id === active), 'aria-controls': `${prefix}-panel`, tabIndex: item.id === active ? 0 : -1, text: item.label,
  }));
  buttons.forEach((b, index) => {
    b.addEventListener('click', () => onSelect(items[index].id));
    b.addEventListener('keydown', event => {
      const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      const next = (target + buttons.length) % buttons.length;
      onSelect(items[next].id, true);
    });
  });
  list.append(...buttons);
  const panel = h('div', { class: 'tabpanel', role: 'tabpanel', id: `${prefix}-panel`, 'aria-labelledby': `${prefix}-tab-${active}`, tabIndex: 0 });
  return { list, panel, focusActive: () => list.querySelector('[aria-selected=true]')?.focus() };
}

// Relation thread used in rows: machine → runtime → round.
export function chain(parts, label) {
  const items = parts.filter(Boolean);
  // Each arrow stays with the node it points to, so wrapping never leaves a dangling arrow.
  return h('span', { class: 'chain', title: label ?? items.join(' → ') }, items.map((part, index) => (index
    ? h('span', { class: 'chain-step' }, h('span', { class: 'chain-link' }, h('span', { class: 'sr-only', text: '，' })), h('span', { class: 'chain-node', text: part }))
    : h('span', { class: 'chain-node', text: part }))));
}

// The signature: rounds are woven along one weft thread, newest at the end.
export function weft(rounds, currentId, onSelect) {
  return h('ol', { class: 'weft', 'aria-label': '轮次' }, rounds.map(round => h('li', { class: 'weft-node', dataset: { tone: round.tone, current: String(round.id === currentId) } },
    h('button', { type: 'button', 'aria-current': round.id === currentId ? 'step' : undefined, onClick: () => onSelect(round.id) },
      h('span', { class: 'knot', 'aria-hidden': 'true', text: String(round.ordinal) }),
      h('span', { class: 'weft-label' }, h('strong', { text: `第 ${round.ordinal} 轮` }), h('small', { text: round.phaseLabel }))))));
}

export function avatar(name, hue = 0, size = 'md') {
  return h('span', { class: 'avatar', dataset: { hue: String(hue), size }, 'aria-hidden': 'true', text: Array.from(name.trim())[0] ?? '?' });
}

// ---- Overlays ------------------------------------------------------------

let layer = null;
export function closeLayer() { layer?.close(); }

export function popover(trigger, build, { align = 'start', className = 'menu', role = 'menu', label } = {}) {
  if (layer?.trigger === trigger) { layer.close(); return null; }
  closeLayer();
  const node = h('div', { class: `${className} glass`, role, 'aria-label': label, tabIndex: -1 });
  const close = (restore = false) => {
    if (!node.isConnected) return;
    node.remove();
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', onResize);
    if (layer?.node === node) layer = null;
    if (restore && trigger.isConnected) trigger.focus();
  };
  append(node, build(close));
  document.body.append(node);
  trigger.setAttribute('aria-expanded', 'true');
  place(node, trigger, align);
  const items = () => [...node.querySelectorAll('[role=menuitem],[role=menuitemradio]')].filter(item => !item.disabled);
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (role !== 'menu') return;
    if (event.key === 'Tab') { close(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const list = items(), at = list.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }
  function onDown(event) { if (!node.contains(event.target) && !trigger.contains(event.target)) close(false); }
  function onResize() { close(false); }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onResize);
  layer = { node, trigger, close };
  const first = role === 'menu' ? items()[0] : node.querySelector('[aria-checked=true], button, input, select');
  (first ?? node).focus();
  return layer;
}

function place(node, trigger, align) {
  const rect = trigger.getBoundingClientRect();
  const width = node.offsetWidth, height = node.offsetHeight, gap = 6, edge = 8;
  let left = align === 'end' ? rect.right - width : rect.left;
  left = Math.max(edge, Math.min(left, innerWidth - width - edge));
  let top = rect.bottom + gap;
  if (top + height > innerHeight - edge) top = rect.top - height - gap >= edge ? rect.top - height - gap : Math.max(edge, innerHeight - height - edge);
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

export function menuItem(label, { icon: name, onSelect, danger, disabled, description, checked, close } = {}) {
  const node = h('button', {
    type: 'button', class: 'menu-item', role: checked === undefined ? 'menuitem' : 'menuitemradio', tabIndex: -1, disabled,
    'aria-checked': checked === undefined ? undefined : String(checked), dataset: danger ? { tone: 'danger' } : undefined,
  }, name ? icon(name) : h('span', { class: 'icon-space' }),
  h('span', { class: 'menu-text' }, h('span', { text: label }), description ? h('small', { text: description }) : null),
  checked ? icon('check', 'icon menu-check') : null);
  node.addEventListener('click', () => { close?.(true); onSelect?.(); });
  return node;
}
export const menuSeparator = () => h('div', { class: 'menu-sep', role: 'separator' });
export const menuLabel = text => h('div', { class: 'menu-label', text });

export function openDialog({ title, description, body, actions = [], size = 'md', returnFocus }) {
  const opener = document.activeElement;
  const titleId = nextId('dialog-title');
  const dialog = h('dialog', { class: 'dialog', dataset: { size }, 'aria-labelledby': titleId });
  const close = value => dialog.close(value);
  const result = new Promise(resolve => dialog.addEventListener('close', () => {
    dialog.remove();
    const target = returnFocus?.() ?? opener;
    if (target?.isConnected) target.focus();
    resolve(dialog.returnValue);
  }, { once: true }));
  const foot = h('div', { class: 'dialog-foot' });
  const content = h('div', { class: 'dialog-body' });
  const setBody = (node, footActions = []) => { content.replaceChildren(); append(content, node); foot.replaceChildren(...footActions); foot.hidden = !footActions.length; };
  dialog.append(
    h('div', { class: 'dialog-head' }, h('div', {}, h('h2', { id: titleId, text: title }), description ? h('p', { class: 'dialog-desc', text: description }) : null),
      button('关闭', { icon: 'x', iconOnly: true, variant: 'ghost', size: 'sm', className: 'dialog-close', onClick: () => close('cancel') })),
    content, foot);
  setBody(body ?? null, actions);
  document.body.append(dialog);
  closeLayer();
  dialog.showModal();
  // Sandboxed previews ignore autofocus, so focus the first meaningful control explicitly.
  (dialog.querySelector('.dialog-body input, .dialog-body select, .dialog-body textarea') ?? foot.querySelector('[data-variant=primary], [data-variant=danger]') ?? foot.querySelector('button'))?.focus();
  return { dialog, close, result, setBody, title: dialog.querySelector('h2') };
}

export function confirmDialog(message, { title = '确认操作', confirmLabel = '确认', danger = false } = {}) {
  let handle;
  const cancel = button('取消', { onClick: () => handle.close('no') });
  const ok = button(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => handle.close('yes') });
  handle = openDialog({ title, description: message, size: 'sm', actions: [cancel, ok] });
  (danger ? cancel : ok).focus();
  return handle.result.then(value => value === 'yes');
}

export function toast(message, tone = 'ok') {
  const region = document.getElementById('toasts');
  const node = h('div', { class: 'toast glass', dataset: { tone } }, icon(tone === 'ok' ? 'check' : tone === 'warn' ? 'st-attention' : 'info'), h('span', { text: message }));
  region.append(node);
  setTimeout(() => node.classList.add('leaving'), 3400);
  setTimeout(() => node.remove(), 3800);
}

// List + inspector. Wide screens show the panel beside the list; narrower ones overlay it.
export function splitView(label, onClose) {
  const list = h('div', { class: 'split-list' });
  const panel = h('aside', { class: 'panel', 'aria-label': label, tabIndex: -1, hidden: true });
  const root = h('div', { class: 'split', dataset: { open: 'false' } }, list, panel);
  let key = null, opener = null;
  const view = {
    root, list, panel,
    get key() { return key; },
    open(node, nextKey, { from, focus = true } = {}) {
      if (from) opener = from;
      key = nextKey;
      panel.replaceChildren(node);
      panel.hidden = false;
      root.dataset.open = 'true';
      document.body.dataset.panel = 'open';
      if (focus) requestAnimationFrame(() => (panel.querySelector('.panel-head h2') ?? panel).focus());
    },
    close({ restore = true } = {}) {
      if (key === null) return;
      key = null;
      panel.hidden = true;
      panel.replaceChildren();
      root.dataset.open = 'false';
      delete document.body.dataset.panel;
      onClose?.();
      const target = opener?.isConnected ? opener : root.querySelector(`[data-key="${CSS.escape(opener?.dataset?.key ?? '')}"]`);
      if (restore && target) target.focus();
    },
    setOpener(node) { opener = node; },
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest('dialog')) { event.preventDefault(); view.close(); }
  });
  return view;
}

export function panelHead({ title, eyebrow, badges = [], sub = [], actions = [], onClose }) {
  return h('header', { class: 'panel-head' },
    h('div', { class: 'panel-heading' },
      eyebrow ? h('p', { class: 'panel-eyebrow', text: eyebrow }) : null,
      h('h2', { tabIndex: -1, text: title }),
      badges.length || sub.length ? h('div', { class: 'panel-sub' }, badges, sub) : null),
    h('div', { class: 'panel-tools' }, actions, button('关闭详情', { icon: 'x', iconOnly: true, variant: 'ghost', size: 'sm', onClick: onClose })));
}

// Arrow keys move between rows; Enter or Space opens the focused row.
export function rovingRows(container) {
  container.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !event.target.matches('.row')) return;
    const rows = [...container.querySelectorAll('.row')];
    const at = rows.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : at + (event.key === 'ArrowDown' ? 1 : -1);
    if (rows[next]) { event.preventDefault(); rows[next].focus(); }
  });
}

export function inlineEdit({ label, value, max = 80, onSave, editable = true, mono: isMono = false }) {
  const wrap = h('div', { class: 'inline-edit' });
  let trigger;
  const show = () => {
    trigger = editable ? button(`修改${label}`, { icon: 'edit', iconOnly: true, variant: 'ghost', size: 'sm', onClick: edit }) : null;
    wrap.replaceChildren(h('span', { class: isMono ? 'inline-value mono' : 'inline-value', text: value }), trigger);
  };
  const edit = () => {
    const input = field(label, { value, max, required: true });
    const node = h('form', { class: 'inline-form' }, input.node, h('div', { class: 'inline-actions' },
      button('取消', { variant: 'ghost', size: 'sm', onClick: () => { show(); trigger?.focus(); } }),
      button('保存', { type: 'submit', variant: 'primary', size: 'sm' })));
    node.addEventListener('submit', async event => { event.preventDefault(); await onSave(input.input.value.trim()); });
    node.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); show(); trigger?.focus(); } });
    wrap.replaceChildren(node);
    input.input.focus();
    input.input.select();
  };
  show();
  return wrap;
}
