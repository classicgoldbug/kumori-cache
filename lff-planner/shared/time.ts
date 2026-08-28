/**
 * Time handling. All schedule arithmetic uses "festival minutes" — minutes
 * since 00:00 on the festival's start date, computed from the wall-clock
 * fields of ISO strings. Date objects are never used for comparisons, so a
 * phone in another timezone can't corrupt the schedule. (The LFF sits
 * entirely inside BST, so wall-clock arithmetic is safe.)
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "2026-10-09T20:45:00+01:00" → { date: "2026-10-09", minuteOfDay: 1245 } */
export function parseIso(iso: string): { date: string; minuteOfDay: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`unparseable ISO date-time: ${iso}`);
  return { date: `${m[1]}-${m[2]}-${m[3]}`, minuteOfDay: Number(m[4]) * 60 + Number(m[5]) };
}

/** Days between two YYYY-MM-DD dates (b - a), via UTC to dodge DST. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Minutes since 00:00 on startDate. */
export function festivalMinutes(startDate: string, iso: string): number {
  const { date, minuteOfDay } = parseIso(iso);
  return daysBetween(startDate, date) * 1440 + minuteOfDay;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD between from and to. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] as Weekday;
}

/** "16:30" → 990 */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** 1245 → "20:45" */
export function minutesToHm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Human-friendly "Thu 9 Oct" from YYYY-MM-DD. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${wd} ${d} ${mo}`;
}
