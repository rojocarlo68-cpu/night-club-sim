/**
 * Prompt A Phase 10: placeholder reputation / return-chance config.
 * getReturnChanceHint() uses these — NOT wired to spawning yet (TODO).
 */

/** Recent visit sats kept per patron identity name. */
export const REPUTATION_VISIT_CAP = 12;

/**
 * Piecewise return-chance hint from average recent satisfaction (0..100 → 0..1).
 * Placeholder curves for future spawn weighting — do not use in spawnPatron yet.
 */
export const RETURN_CHANCE = {
  atSat0: 0.12,
  atSat50: 0.48,
  atSat100: 0.88,
  /** Blend toward this when no history yet. */
  defaultWhenUnknown: 0.55,
} as const;
