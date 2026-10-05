/**
 * Special tip-generation actions (Phase 3).
 * Tuning values — balance later; add more actions by appending to TIP_ACTIONS.
 */

export interface TipAction {
  id: string;
  /** Spanish status label shown while the action is active. */
  label: string;
  energyCost: number;
  moodCost: number;
  durationMs: number;
  /** Additive bonus to tip chance (0..1). */
  tipChanceBonus: number;
  /** Multiplier on tip amount when a tip is awarded. */
  tipAmountMult: number;
  minSociability: number;
  minDisinhibition: number;
  /** Base chance the staff refuses this action (scaled by 1 - disinhibition). */
  refusalBase: number;
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
  },
];

export function getTipAction(id: string): TipAction | undefined {
  return TIP_ACTIONS.find((a) => a.id === id);
}
