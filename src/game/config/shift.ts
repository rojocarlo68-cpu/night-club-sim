/**
 * Prompt B — central tunables for the shift / game-time clock.
 * B2+: clock advances while OPEN/CLOSING; HUD shows HH:MM.
 * B7: night ends on manual Cerrar (CLOSING → SUMMARY), NOT a 75s timer / NOT at 02:00.
 */

/** Recommended club hours (informational; not a hard lock). */
export const RECOMMENDED_OPEN_HOUR = 18;
export const RECOMMENDED_OPEN_MINUTE = 0;
export const RECOMMENDED_CLOSE_HOUR = 2;
export const RECOMMENDED_CLOSE_MINUTE = 0;

/** Default wall-clock when a day starts closed (before Abrir noche). Frozen until open. */
export const PRE_OPEN_HOUR = 17;
export const PRE_OPEN_MINUTE = 0;

/**
 * Real seconds that must elapse for one game-minute to advance while OPEN/CLOSING.
 * B2 choice: 1 → one game minute per real second (easy to verify in smoke tests).
 */
export const REAL_SECONDS_PER_GAME_MINUTE = 1;

/** Derived helper (game minutes advanced per real second). */
export const CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND =
  1 / REAL_SECONDS_PER_GAME_MINUTE;

/** Desktop schedule hint under the clock. */
export const SCHEDULE_LABEL = 'Horario sugerido: Lun–Dom · 18:00 — 02:00';

/** Shorter hint for narrow / mobile HUD. */
export const SCHEDULE_LABEL_MOBILE = 'Horario: 18:00 — 02:00';

/** Compact recommended range (debug / short lines). */
export const SCHEDULE_RANGE_SHORT = '18:00 — 02:00';

/**
 * B7 CLOSING: after this many real ms, nudge remaining patrons to leave via sendPatronHome.
 * They finish walking out; not an instant despawn.
 */
export const CLOSING_NUDGE_AFTER_MS = 20000;

/**
 * B7 CLOSING safety: if patrons still on the floor after this, force SUMMARY
 * (destroys leftovers). Generous so normal visits can finish.
 */
export const CLOSING_FORCE_SUMMARY_MS = 120000;


/**
 * B11: when true (default), Abrir snaps clock to recommended open (18:00).
 * When false, open at the current frozen CLOSED time (still 17:00 unless
 * debugSetGameTime moved the frozen clock — useful for late-open tests).
 */
export const USE_SNAP_TO_RECOMMENDED_OPEN = true;
