/**
 * Special tip-generation actions (Phase 3 + Prompt A Phase 9 tastes).
 * Tuning values — balance later; add more actions by appending to TIP_ACTIONS.
 *
 * Shape (extensible — reuse existing fields, do not duplicate):
 *   energyCost, moodCost, durationMs (= duration), tipChanceBonus (= tipChanceMod),
 *   tipAmountMult, satisfactionMod (base sat magnitude), tasteDist? (optional override).
 */

/** Weights for rolling a patron's taste toward an action (need not sum to 1). */
export interface ActionTasteDist {
  like: number;
  neutral: number;
  dislike: number;
}

export interface TipAction {
  id: string;
  /** Spanish status label shown while the action is active. */
  label: string;
  energyCost: number;
  moodCost: number;
  /** Duration of the action in ms (the "duration" field). */
  durationMs: number;
  /**
   * Additive bonus to tip chance (0..1). This IS tipChanceMod — existing tip
   * pipeline reads tipChanceBonus; do not add a parallel field.
   */
  tipChanceBonus: number;
  /** Multiplier on tip amount when a tip is awarded. */
  tipAmountMult: number;
  minSociability: number;
  minDisinhibition: number;
  /** Base chance the staff refuses this action (scaled by 1 - disinhibition). */
  refusalBase: number;
  /**
   * Prompt A Phase 9: base customerSatisfaction delta magnitude.
   * Scaled by patron taste (−1..+1): like → +mod, neutral → small +, dislike → −mod.
   * Does not alter tipChanceBonus / tipAmountMult.
   */
  satisfactionMod: number;
  /** Optional per-action taste distribution; falls back to ACTION_TASTE_DEFAULTS. */
  tasteDist?: ActionTasteDist;
}

/** Catalog of tip actions. Append new entries here — picker picks by personality. */
export const TIP_ACTIONS: TipAction[] = [
  {
    id: 'dance',
    label: 'Bailando',
    energyCost: 12,
    moodCost: 4,
    durationMs: 2500,
    tipChanceBonus: 0.35,
    tipAmountMult: 1.6,
    minSociability: 0,
    minDisinhibition: 0.5,
    refusalBase: 0.25,
    satisfactionMod: 8,
    tasteDist: { like: 0.45, neutral: 0.4, dislike: 0.15 },
  },
  {
    id: 'kiss',
    label: 'Lanzando un beso',
    energyCost: 2,
    moodCost: 1,
    durationMs: 900,
    tipChanceBonus: 0.15,
    tipAmountMult: 1.15,
    minSociability: 0.3,
    minDisinhibition: 0.25,
    refusalBase: 0.15,
    satisfactionMod: 5,
    tasteDist: { like: 0.35, neutral: 0.45, dislike: 0.2 },
  },
  {
    id: 'photo',
    label: 'Foto con el cliente',
    energyCost: 6,
    moodCost: 2,
    durationMs: 1800,
    tipChanceBonus: 0.3,
    tipAmountMult: 1.4,
    minSociability: 0.4,
    minDisinhibition: 0.1,
    refusalBase: 0.2,
    satisfactionMod: 7,
    tasteDist: { like: 0.5, neutral: 0.4, dislike: 0.1 },
  },
];

/** Fallback when an action omits tasteDist (future actions). */
export const ACTION_TASTE_FALLBACK: ActionTasteDist = {
  like: 0.4,
  neutral: 0.45,
  dislike: 0.15,
};

/**
 * Prompt A Phase 9: map rolled category → taste score in [−1, +1].
 * Neutral is a small positive so "meh" still feels mildly ok, not zero impact.
 */
export const ACTION_TASTE_SCORES = {
  like: 1,
  neutral: 0.25,
  dislike: -1,
} as const;

export function getTipAction(id: string): TipAction | undefined {
  return TIP_ACTIONS.find((a) => a.id === id);
}

/** Resolve taste distribution for an action (per-action override → fallback). */
export function tasteDistFor(action: TipAction): ActionTasteDist {
  return action.tasteDist ?? ACTION_TASTE_FALLBACK;
}
