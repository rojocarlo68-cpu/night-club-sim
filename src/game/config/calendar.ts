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
