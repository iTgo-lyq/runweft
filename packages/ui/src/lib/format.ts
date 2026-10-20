// Chinese date and time wording shared by the Hub and the prototype. Products use the viewer's time zone;
// previews may pin a zone and pass a fixed `now` so every review sees the same text.
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
let clock: Intl.DateTimeFormat, day: Intl.DateTimeFormat, full: Intl.DateTimeFormat;

export function setDisplayTimeZone(timeZone?: string) {
  clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  day = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone });
  full = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}
setDisplayTimeZone();

export function relativeTime(time: number | null | undefined, now = Date.now()) {
  if (time === null || time === undefined) return '暂无记录';
  const diff = now - time;
  if (diff < 0) {
    const hours = Math.round(-diff / HOUR);
    return hours < 1 ? '1 小时内过期' : `${hours} 小时后过期`;
  }
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (day.format(time) === day.format(now)) return `今天 ${clock.format(time)}`;
  if (day.format(time) === day.format(now - DAY)) return `昨天 ${clock.format(time)}`;
  return day.format(time);
}

export const fullTime = (time: number | null | undefined) => (time ? full.format(time) : '暂无记录');
export const clockTime = (time: number) => clock.format(time);
export const dayLabel = (time: number) => day.format(time);
export const initial = (name: string) => Array.from(name.trim())[0] ?? '?';
