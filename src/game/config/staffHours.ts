/**
 * Prompt B Phase B8 — staff shift hours / future fatigue tunables.
 * Fatigue is NOT applied to energy/mood yet (B11+).
 */

/** Overtime starts at/after this game clock (recommended close). */
export const OVERTIME_AFTER_HOUR = 2;
export const OVERTIME_AFTER_MINUTE = 0;

/**
 * Placeholder: future fatigue points per overtime game-hour past OVERTIME_AFTER.
 * DO NOT apply to staff energy/mood yet.
 */
export const FATIGUE_PER_OVERTIME_HOUR = 8;

/** Cap on pendingFatigue accumulator (future). */
export const FATIGUE_PENDING_CAP = 100;
