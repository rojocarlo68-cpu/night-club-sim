/**
 * Prompt A Phase 7: apply hidden visit satisfaction + generosity to tips.
 * Pure multipliers on top of the existing tip pipeline — does not replace it.
 */

import {
  SAT_MIN,
  SAT_MAX,
  SATISFACTION_TIPS,
  TIP_DEBUG_CAP,
} from '../config/satisfaction';

export interface SatisfactionTipMods {
  chanceMult: number;
  amountMult: number;
  sat: number;
  generosity: number;
}

export interface TipDebugEntry {
  patronName: string;
  staffId: string;
  sat: number;
  generosity: number;
  chanceBefore: number;
  chanceAfter: number;
  chanceMult: number;
  amountMult: number;
  tipAmount: number;
  tipped: boolean;
  atMs: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

function clampSat(v: number): number {
  return Math.max(SAT_MIN, Math.min(SAT_MAX, v));
}

/** Piecewise-linear factor around pivot. */
function satCurve(
  sat: number,
  atMin: number,
  atPivot: number,
  atMax: number,
  pivot: number
): number {
  const s = clampSat(sat);
  if (s <= pivot) {
    const span = Math.max(1e-6, pivot - SAT_MIN);
    return lerp(atMin, atPivot, (s - SAT_MIN) / span);
  }
  const span = Math.max(1e-6, SAT_MAX - pivot);
  return lerp(atPivot, atMax, (s - pivot) / span);
}

/**
 * Compute chance/amount multipliers from current visit sat + generosity.
 * Does not mutate chance/amount — caller multiplies and re-caps.
 */
export function computeSatisfactionTipMods(
  sat: number,
  generosity: number
): SatisfactionTipMods {
  const cfg = SATISFACTION_TIPS;
  const s = clampSat(sat);
  const g = Math.max(0, Math.min(1, generosity));
  let chanceMult = satCurve(
    s,
    cfg.chanceAtMin,
    cfg.chanceAtPivot,
    cfg.chanceAtMax,
    cfg.pivot
  );
  let amountMult = satCurve(
    s,
    cfg.amountAtMin,
    cfg.amountAtPivot,
    cfg.amountAtMax,
    cfg.pivot
  );
  if (s < cfg.veryLowBelow) {
    chanceMult *= cfg.veryLowChanceExtra;
    amountMult *= cfg.veryLowAmountExtra;
  }
  chanceMult *= lerp(cfg.genChanceMin, cfg.genChanceMax, g);
  amountMult *= lerp(cfg.genAmountMin, cfg.genAmountMax, g);
  return {
    chanceMult: Math.round(chanceMult * 1000) / 1000,
    amountMult: Math.round(amountMult * 1000) / 1000,
    sat: s,
    generosity: Math.round(g * 1000) / 1000,
  };
}

/**
 * Apply mods to a tip chance from the existing pipeline.
 * Re-caps to tipChanceCap; floors at chanceFloor (sat alone never hard-zeros).
 */
export function applySatisfactionToTipChance(
  tipChance: number,
  mods: SatisfactionTipMods
): number {
  const cfg = SATISFACTION_TIPS;
  let c = tipChance * mods.chanceMult;
  c = Math.min(cfg.tipChanceCap, c);
  // Floor only when sat crushed an otherwise-viable chance — never inflate a
  // pipeline chance that was already below the floor (broken furniture, etc.).
  if (tipChance >= cfg.chanceFloor && c < cfg.chanceFloor) c = cfg.chanceFloor;
  c = Math.max(0, c);
  return Math.round(c * 1000) / 1000;
}

/** Amount multiplier including controlled ±jitter. */
export function satisfactionAmountScale(
  mods: SatisfactionTipMods,
  rng: () => number = Math.random
): number {
  const jitter =
    1 + (rng() * 2 - 1) * SATISFACTION_TIPS.amountJitterFrac;
  return mods.amountMult * jitter;
}

/* ── Debug ring ── */

const tipDebug: TipDebugEntry[] = [];

export function pushTipDebug(entry: Omit<TipDebugEntry, 'atMs'>): void {
  tipDebug.push({ ...entry, atMs: Date.now() });
  while (tipDebug.length > TIP_DEBUG_CAP) tipDebug.shift();
}

export function getTipDebug(): TipDebugEntry[] {
  return tipDebug.map((e) => ({ ...e }));
}

export function clearTipDebug(): void {
  tipDebug.length = 0;
}
