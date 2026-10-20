// The prototype runs on a fixed clock so every review sees the same relative times.
export const NOW = Date.parse('2026-10-19T10:00:00+08:00');
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const ago = { minutes: n => NOW - n * MINUTE, hours: n => NOW - n * HOUR, days: n => NOW - n * DAY };
export const later = { hours: n => NOW + n * HOUR };
