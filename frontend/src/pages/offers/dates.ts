// Cairo calendar days for the offer form. No imports, so it runs under
// `node --test` (tests/offers*.test.mjs).
//
// The backend reads a date-only start ("YYYY-MM-DD") as the start of that
// day in Cairo and a date-only end as the end of that day (the instant the
// next Cairo day starts) — schemas._promotion_start / _offer_end.

const CAIRO = 'Africa/Cairo';

/** Today's Cairo calendar date ("YYYY-MM-DD"). */
export function cairoToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: CAIRO });
}

/** `day` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n);
  return new Date(t).toISOString().slice(0, 10);
}

/** An API timestamp as epoch ms. One without a zone is UTC — the engine
 * reads it the same way (promotions._aware); SQLite returns them naive. */
export function parseInstant(iso: string): number {
  const s = iso.trim();
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`);
}

/** An instant as its Cairo calendar date. `exclusiveEnd`: the instant is
 * the start of the day after the last day (an `ends_at`). */
export function cairoDate(iso: string | null | undefined, exclusiveEnd = false): string {
  if (!iso) return '';
  const t = parseInstant(iso) - (exclusiveEnd ? 1 : 0);
  return new Date(t).toLocaleDateString('en-CA', { timeZone: CAIRO });
}

/** Wall-clock parts of an instant in Cairo. */
function cairoParts(t: number): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** The UTC instant (ms) at which Cairo day `day` starts (00:00 Cairo). */
export function cairoMidnightUtc(day: string): number {
  const target = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  let t = target - 2 * 3600_000; // Cairo is UTC+2 or +3
  for (let i = 0; i < 3; i++) {
    const p = cairoParts(t);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (shown === target) break;
    t += target - shown;
  }
  return t;
}

/** "YYYY-MM-DD" as an Arabic date ("١٩ نوفمبر ٢٠٢٦"). */
export function dateLabel(day: string, withWeekday = false): string {
  if (!day) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('ar-EG', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', ...(withWeekday ? { weekday: 'long' as const } : {}),
  });
}

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
