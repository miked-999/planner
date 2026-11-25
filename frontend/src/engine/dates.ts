import type { WeekBucket } from '../types/plan';

const MS_PER_DAY = 86_400_000;
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function parseIsoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcMsToIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIsoLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 0 = Monday ... 4 = Friday, 5 = Saturday, 6 = Sunday */
export function dayOfWeekMon0(iso: string): number {
  const jsDay = new Date(parseIsoToUtcMs(iso)).getUTCDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7;
}

export function isWorkingDay(iso: string): boolean {
  return dayOfWeekMon0(iso) < 5;
}

export function addCalendarDays(iso: string, deltaDays: number): string {
  return utcMsToIso(parseIsoToUtcMs(iso) + deltaDays * MS_PER_DAY);
}

export function calendarDaysBetween(startIso: string, endIso: string): number {
  return Math.round((parseIsoToUtcMs(endIso) - parseIsoToUtcMs(startIso)) / MS_PER_DAY);
}

export function snapToWorkingDay(
  iso: string,
  direction: 'forward' | 'backward' = 'forward',
): string {
  let cur = iso;
  const step = direction === 'forward' ? 1 : -1;
  while (!isWorkingDay(cur)) {
    cur = addCalendarDays(cur, step);
  }
  return cur;
}

export function addWorkingDays(iso: string, deltaWorkingDays: number): string {
  let cur = snapToWorkingDay(iso, deltaWorkingDays >= 0 ? 'forward' : 'backward');
  let remaining = Math.abs(deltaWorkingDays);
  const step = deltaWorkingDays >= 0 ? 1 : -1;
  while (remaining > 0) {
    cur = addCalendarDays(cur, step);
    if (isWorkingDay(cur)) {
      remaining -= 1;
    }
  }
  return cur;
}

export function nextWorkingDayAfter(endIso: string): string {
  let cur = addCalendarDays(endIso, 1);
  while (!isWorkingDay(cur)) {
    cur = addCalendarDays(cur, 1);
  }
  return cur;
}

export function workingDaysInclusive(startIso: string, endIso: string): number {
  if (endIso < startIso) return 0;
  let count = 0;
  let cur = startIso;
  while (cur <= endIso) {
    if (isWorkingDay(cur)) count += 1;
    cur = addCalendarDays(cur, 1);
  }
  return Math.max(1, count);
}

/**
 * Signed working-day difference from `fromIso` to `toIso`.
 * Positive when `toIso > fromIso`, negative when `toIso < fromIso`, 0 when equal.
 */
export function workingDaysSignedDiff(fromIso: string, toIso: string): number {
  if (fromIso === toIso) return 0;
  const forward = toIso > fromIso;
  const low = forward ? fromIso : toIso;
  const high = forward ? toIso : fromIso;
  let count = 0;
  let cur = addCalendarDays(low, 1);
  while (cur <= high) {
    if (isWorkingDay(cur)) count += 1;
    cur = addCalendarDays(cur, 1);
  }
  return forward ? count : -count;
}

export function mondayOfWeek(iso: string): string {
  const dow = dayOfWeekMon0(iso);
  return addCalendarDays(iso, -dow);
}

export function generateWeeks(startIso: string, endIso: string): WeekBucket[] {
  const firstMonday = mondayOfWeek(startIso);
  const lastMonday = mondayOfWeek(endIso);
  const buckets: WeekBucket[] = [];
  const monthWeekCounter = new Map<string, number>();

  let curMonday = firstMonday;
  while (curMonday <= lastMonday) {
    const thursday = addCalendarDays(curMonday, 3); // ISO rule: Thursday determines month/week ownership
    const thuDate = new Date(parseIsoToUtcMs(thursday));
    const yr = thuDate.getUTCFullYear();
    const mo = thuDate.getUTCMonth();
    const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;
    const nextIdx = (monthWeekCounter.get(monthKey) ?? 0) + 1;
    monthWeekCounter.set(monthKey, nextIdx);

    const workingDays = [0, 1, 2, 3, 4].map((offset) => addCalendarDays(curMonday, offset));
    const friday = workingDays[4];
    const sunday = addCalendarDays(curMonday, 6);

    buckets.push({
      weekStart: curMonday,
      weekEnd: friday,
      sundayEnd: sunday,
      weekLabel: `W${nextIdx}`,
      shortRange: `${formatShortDate(curMonday)} – ${formatShortDate(friday)}`,
      monthKey,
      monthLabel: `${LONG_MONTHS[mo]} ${yr}`,
      workingDays,
    });

    curMonday = addCalendarDays(curMonday, 7);
  }
  return buckets;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

export function formatMediumDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

export function formatDurationLabel(workingDays: number): string {
  if (workingDays % 5 === 0 && workingDays >= 5) {
    const w = workingDays / 5;
    return `${w}w (${workingDays}d)`;
  }
  return `${workingDays} wd`;
}

export function formatSignedWorkingDays(days: number): string {
  if (days === 0) return '0 wd';
  const sign = days > 0 ? '+' : '−';
  const abs = Math.abs(days);
  if (abs % 5 === 0 && abs >= 5) {
    const w = abs / 5;
    return `${sign}${w}w (${abs}d)`;
  }
  return `${sign}${abs} wd`;
}
