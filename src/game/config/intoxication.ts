/**
 * FUTURE customer intoxication — tuning only (architecture prepared, NOT active).
 * The level is computed (systems/PatronIntoxication.ts) but nothing reads it to change
 * behaviour yet. Same shape as the staff model (config/staffConsumption.ts ALCOHOL) so the
 * two can converge later, but intentionally not coupled.
 */
export const PATRON_ALCOHOL = {
  /** Intoxication (0..1) added per alcohol unit at tolerance 0.5 (scaled by 0.5 / tolerance). */
  perUnit: 0.18,
  /** Intoxication decay per real second since the last drink (1 real s = 1 game min). */
  decayPerSec: 0.002,
  tipsyAt: 0.3,
  drunkAt: 0.65,
  /** Stable per-customer tolerance range (hash of identity → value in range). */
  toleranceRange: [0.3, 1.0] as [number, number],
  /** Emojis reserved for this system (see config/thoughts.ts RESERVED_INTOX_EMOTES). */
  emotes: { tipsy: '🍺', drunk: '🤪', veryDrunk: '😵‍💫' },
} as const;
