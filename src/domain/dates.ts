// Calendar dates are local-time YYYY-MM-DD strings, so they sort and compare as strings.

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of `now` as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isDateStr(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

/** True when the date is after today. */
export function isFuture(date: string, now: Date = new Date()): boolean {
  return date > today(now);
}

/**
 * The newest calendar date anywhere on Earth at `now` (UTC+14). A date saved as "today" in a time
 * zone further east is still after today here.
 */
export function latestDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** A valid date that is not after `max` (default: today here); anything else becomes today. */
export function safeDate(v: unknown, now: Date = new Date(), max: string = today(now)): string {
  return isDateStr(v) && v <= max ? v : today(now);
}

/** True for a string that parses as a timestamp. */
export function isIsoStamp(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));
}
