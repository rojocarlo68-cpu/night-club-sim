/**
 * Phase 7: night-based calendar intervals (no full calendar yet).
 * Tunable for weekly salaries (Phase 8) and monthly utilities (Phase 9).
 */

/** Nights between weekly due events (salaries). */
export const NIGHTS_PER_WEEK = 7;

/** Nights between monthly due events (gas / water / electricity). */
export const NIGHTS_PER_MONTH = 30;

/** True when night `n` ends a week (7, 14, 21, …). */
export function isWeekEnd(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n % NIGHTS_PER_WEEK === 0;
}

/** True when night `n` ends a month (30, 60, …). */
export function isMonthEnd(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n % NIGHTS_PER_MONTH === 0;
}

/** Next night number that triggers weekly dues after `n` (or the following if `n` is already a week end). */
export function nextWeekEndNight(n: number): number {
  const cur = Math.max(0, Math.floor(n) || 0);
  const rem = cur % NIGHTS_PER_WEEK;
  return rem === 0 ? cur + NIGHTS_PER_WEEK : cur + (NIGHTS_PER_WEEK - rem);
}

/** Next night number that triggers monthly dues after `n` (or the following if `n` is already a month end). */
export function nextMonthEndNight(n: number): number {
  const cur = Math.max(0, Math.floor(n) || 0);
  const rem = cur % NIGHTS_PER_MONTH;
  return rem === 0 ? cur + NIGHTS_PER_MONTH : cur + (NIGHTS_PER_MONTH - rem);
}

