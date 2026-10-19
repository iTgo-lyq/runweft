// Small DOM helpers. All user-visible text goes through textContent; nothing is parsed as HTML.
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function mark() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#runweft-mark');
  svg.append(use);
  return svg;
}

// The prototype runs on a fixed clock so every review sees the same relative times.
export const NOW = Date.parse('2026-10-19T10:00:00+08:00');
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const ago = { minutes: n => NOW - n * MINUTE, hours: n => NOW - n * HOUR, days: n => NOW - n * DAY };
export const later = { hours: n => NOW + n * HOUR };

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });
const full = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });

export function relative(time) {
  if (time === null || time === undefined) return '暂无记录';
  const diff = NOW - time;
  if (diff < 0) {
    const hours = Math.round(-diff / HOUR);
    return hours < 1 ? '1 小时内过期' : `${hours} 小时后过期`;
  }
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (date.format(time) === date.format(NOW)) return `今天 ${clock.format(time)}`;
  if (date.format(time) === date.format(NOW - DAY)) return `昨天 ${clock.format(time)}`;
  return date.format(time);
}
export const fullTime = time => (time ? full.format(time) : '暂无记录');
export const clockTime = time => clock.format(time);
export const dayLabel = time => date.format(time);

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(16).slice(2, 6)}`;
}

export const initial = name => Array.from(name.trim())[0] ?? '?';
