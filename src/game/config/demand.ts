/**
 * Prompt B Phase B4–B6 — organic patron arrivals (early-night conservative).
 * Phase B6: quiet stretches (15–30+ min) common; low group chance; hour curve.
 * Times are in GAME minutes (see REAL_SECONDS_PER_GAME_MINUTE in shift.ts).
 *
 * EARLY_NIGHT_SOFT_CAP is a CEILING / potential max — NOT a fill target.
 * Nights often end below the cap (demandScale + quiet stretches).
 */

/**
 * Soft max potential patrons for early nights (ceiling, not a quota to fill).
 * Effective cap = max(2, round(EARLY_NIGHT_SOFT_CAP * earlyNightDemandScale(night))).
 */
export const EARLY_NIGHT_SOFT_CAP = 6;

/** Placeholder base demand (B11 will scale with reputation / amenities). */
export const BASE_DEMAND = 1;

/**
 * Nights 1..EARLY_NIGHT_SCALE_UNTIL use a reduced demand scale (0.7 → 1.0).
 * Lower scale → lower soft cap + longer intervals → more 2–4 patron nights.
 */
export const EARLY_NIGHT_SCALE_UNTIL = 7;
export const EARLY_NIGHT_SCALE_MIN = 0.7;
export const EARLY_NIGHT_SCALE_MAX = 1.0;

/** First arrival delay after Abrir (game minutes). Never 0. Widened for seed variety. */
export const FIRST_ARRIVAL_MIN_GAME_MINUTES = 2;
export const FIRST_ARRIVAL_MAX_GAME_MINUTES = 12;

/** Gap between arrival events (solo or after a group finishes). */
export const MIN_INTERVAL_GAME_MINUTES = 5;
export const MAX_INTERVAL_GAME_MINUTES = 20;

/** Chance an arrival event is a small group (size 2). Keep low. */
export const GROUP_CHANCE = 0.15;
export const MAX_GROUP_SIZE = 2;
/** Extra members arrive this many game minutes after the first of the group. */
export const GROUP_STAGGER_GAME_MINUTES = 1;

/**
 * Quiet periods: after scheduling a gap, chance to stretch it.
 * Tuned so 15–30 game-minute quiet stretches are common early (B6).
 */
export const QUIET_STRETCH_CHANCE = 0.4;
export const QUIET_INTERVAL_MULT = 2.0;
/** When quiet triggers, also clamp gap into at least this many game minutes. */
export const QUIET_MIN_GAME_MINUTES = 15;

/**
 * @deprecated B7 removes the 75s nightTimer. Kept as unused constant until B7 deletes call sites.
 * Stop new arrivals when legacy nightTimer is below this (seconds).
 */
export const STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC = 8;

/**
 * Mild mid-evening peak: multiplies demand (shorter intervals when > 1).
 * Keys = game hour. Default 1 if missing.
 */
export const HOUR_DEMAND_MULT: Record<number, number> = {
  18: 0.85,
  19: 1.1,
  20: 1.15,
  21: 1.0,
  22: 0.8,
  23: 0.7,
  0: 0.65,
  1: 0.6,
  2: 0.55,
};

/** Extra random jitter (±) applied to rolled intervals (game minutes). */
export const INTERVAL_JITTER_GAME_MINUTES = 2;

/**
 * Late-open hook (B5): softCap reduction per full game-hour past recommended open.
 * Currently Abrir snaps clock to 18:00, so this rarely applies until Abrir can keep
 * a later clock (e.g. waiting from 17:00 without snap, or debug openAtGameMinutes).
 */
export const LATE_OPEN_PENALTY_PER_GAME_HOUR = 1;
/** Minimum soft cap after late-open / scale reductions. */
export const MIN_SOFT_CAP = 2;

/**
 * Demand scale for early nights (cap-not-target).
 * Night 1 → EARLY_NIGHT_SCALE_MIN, night EARLY_NIGHT_SCALE_UNTIL+ → MAX.
 */
export function earlyNightDemandScale(nightNumber: number): number {
  const n = Math.max(1, Math.floor(nightNumber) || 1);
  if (n >= EARLY_NIGHT_SCALE_UNTIL) return EARLY_NIGHT_SCALE_MAX;
  const t = (n - 1) / Math.max(1, EARLY_NIGHT_SCALE_UNTIL - 1);
  return EARLY_NIGHT_SCALE_MIN + t * (EARLY_NIGHT_SCALE_MAX - EARLY_NIGHT_SCALE_MIN);
}
