/**
 * Hidden client↔staff affinity (Phase 5).
 * Tuning only — balance later without rewriting behaviour.
 * Staff never read affinity; it only modifies serve outcomes.
 */

export type AffinityLevel = 'baja' | 'normal' | 'alta';

export interface AffinityEffects {
  /** Points added to the patron's nightMood scale (0..100 via patienceRemaining). */
  satisfactionBonus: number;
  /** Additive bonus to tip chance (0..1). */
  tipChanceBonus: number;
  /** Multiplier on tip amount when a tip is awarded. */
  tipAmountMult: number;
}

/** Relative weights when lazily assigning affinity (must sum ≈ 1). */
export const AFFINITY_WEIGHTS: Record<AffinityLevel, number> = {
  alta: 0.2,
  normal: 0.65,
  baja: 0.15,
};

/** Per-level outcome modifiers. Affinity is a strong edge, never a guarantee. */
export const AFFINITY_EFFECTS: Record<AffinityLevel, AffinityEffects> = {
  alta: {
    satisfactionBonus: 18,
    tipChanceBonus: 0.25,
    tipAmountMult: 1.35,
  },
  normal: {
    satisfactionBonus: 0,
    tipChanceBonus: 0,
    tipAmountMult: 1,
  },
  baja: {
    satisfactionBonus: -8,
    tipChanceBonus: -0.1,
    tipAmountMult: 0.85,
  },
};

/** Random jitter so outcomes are not fully deterministic. */
export const AFFINITY_JITTER = {
  /** ± absolute on tip chance. */
  chanceAbs: 0.08,
  /** ± fractional on tip amount. */
  amountFrac: 0.1,
};

/** Hard cap so affinity never makes a tip 100% guaranteed. */
export const AFFINITY_TIP_CHANCE_CAP = 0.92;

/** Order used when rolling a weighted level. */
export const AFFINITY_LEVEL_ORDER: AffinityLevel[] = ['alta', 'normal', 'baja'];
