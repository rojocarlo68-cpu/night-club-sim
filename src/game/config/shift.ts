/**
 * Prompt B — central tunables for the shift / game-time clock.
 * B2: clock advances while OPEN/CLOSING; HUD shows HH:MM (not the 75s countdown).
 */

/** Recommended club hours (informational; not a hard lock — B7 will not auto-close at 02:00). */
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
 * Tune later so a full recommended shift (~8h) fits the intended real-time length.
 *
 * NOTE: the legacy 75s nightTimer still auto-closes the night (B7 will remove that).
 * With this speed, ~75 real seconds ≈ 18:00 → 19:15 of game time before that auto-close.
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
