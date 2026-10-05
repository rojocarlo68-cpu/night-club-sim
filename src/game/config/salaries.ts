/**
 * Phase 8: weekly staff salaries (paid by the club / player).
 * Tuning values — club earns roughly $20–40/night in current tests.
 * Tips belong to staff and are never paid from / into these amounts.
 */

/** Weekly salary by staff profile id (tuning knobs, not final balance). */
export const WEEKLY_SALARIES: Record<string, number> = {
  bartender_luna: 120,
  staff_nova: 90,
};

/** Fallback for future hires without an entry above. */
export const DEFAULT_WEEKLY_SALARY = 100;

/**
 * When true, payroll (and save/load) may leave club money below zero.
 * The night summary shows a warning; the HUD still displays the negative balance.
 */
export const ALLOW_NEGATIVE_BALANCE = true;

/** Weekly salary for a staff id (floored, never negative). */
export function weeklySalaryFor(staffId: string): number {
  const raw =
    staffId && Object.prototype.hasOwnProperty.call(WEEKLY_SALARIES, staffId)
      ? WEEKLY_SALARIES[staffId]
      : DEFAULT_WEEKLY_SALARY;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}
