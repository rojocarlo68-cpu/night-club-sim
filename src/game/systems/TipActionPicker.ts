/**
 * Personality-driven tip-action picker (Phase 3).
 * Does NOT pick max-profit — weights follow affinity + requirements + refusal.
 * Phase 4: optional StaffCondition (existing energy/mood, 0..100) gates actions.
 */

import { getPersonality } from '../config/personality';
import { TIP_ACTIONS, TipAction } from '../config/tipActions';
import {
  EFFORT_MIN_SCALE,
  ENERGY_BAND_MULT,
  ENERGY_BASIC_BOOST,
  MOOD_BAND_MULT,
  MOOD_BASIC_BOOST,
  energyBand,
  moodBand,
} from '../config/staffThresholds';

type CountsMap = Record<string, Record<string, number>>;

let actionCounts: CountsMap = {};

function ensureCounts(staffId: string): Record<string, number> {
  if (!actionCounts[staffId]) actionCounts[staffId] = {};
  return actionCounts[staffId];
}

export function recordActionPerformed(staffId: string, actionId: string): void {
  if (!staffId || !actionId) return;
  const c = ensureCounts(staffId);
  c[actionId] = (c[actionId] || 0) + 1;
}

/** Per-staff counts of tip actions performed (for tests / future stats). */
export function getActionCounts(staffId?: string): CountsMap | Record<string, number> {
  if (staffId) {
    const c = actionCounts[staffId];
    return c ? { ...c } : {};
  }
  const out: CountsMap = {};
  for (const id of Object.keys(actionCounts)) {
    out[id] = { ...actionCounts[id] };
  }
  return out;
}

export function resetActionCounts(): void {
  actionCounts = {};
}

/**
 * Soft gate against requirements: below min → near-zero weight;
 * at/above min → scales up toward 1.
 */
function reqFactor(value: number, min: number): number {
  if (min <= 0) return 1;
  if (value < min) {
    // Far below → ~0; just under → tiny residual (almost never)
    const deficit = min - value;
    return Math.max(0, 0.02 - deficit * 0.08);
  }
  // Comfortably above min → 1; at exact min → ~0.55
  const over = value - min;
  return Math.min(1, 0.55 + over * 1.2);
}

export type EnergyMoodGate = (action: TipAction, staffId: string) => TipAction | null;

/** Current existing-stat values of the staff (Bartender.energy / .mood, 0..100). */
export interface StaffCondition {
  energy: number;
  mood: number;
}

const MAX_ENERGY_COST = Math.max(1, ...TIP_ACTIONS.map((a) => a.energyCost));
const MAX_MOOD_COST = Math.max(1, ...TIP_ACTIONS.map((a) => a.moodCost));

/** Band multiplier scaled by effort: costlier actions feel the penalty more. */
function effortScaled(bandMult: number, cost: number, maxCost: number): number {
  if (bandMult <= 0) return 0;
  const effort = Math.max(0, Math.min(1, cost / maxCost));
  const scale = EFFORT_MIN_SCALE + (1 - EFFORT_MIN_SCALE) * effort;
  return Math.max(0, 1 - (1 - bandMult) * scale);
}

/**
 * Phase 4: weight multiplier for an action given the staff's current energy/mood.
 * 0 = never (critical band, or cost exceeds what she has left).
 */
export function energyMoodWeight(action: TipAction, cond: StaffCondition): number {
  if (action.energyCost > cond.energy) return 0;
  if (action.moodCost > cond.mood) return 0;
  const eMult = effortScaled(ENERGY_BAND_MULT[energyBand(cond.energy)], action.energyCost, MAX_ENERGY_COST);
  const mMult = effortScaled(MOOD_BAND_MULT[moodBand(cond.mood)], action.moodCost, MAX_MOOD_COST);
  return eMult * mMult;
}

/** Phase 4: multiplier on the basic-service weight (tired / bad mood → more basic). */
export function basicServiceBoost(cond: StaffCondition): number {
  return MOOD_BASIC_BOOST[moodBand(cond.mood)] * ENERGY_BASIC_BOOST[energyBand(cond.energy)];
}

/**
 * Pick a tip action (or null = basic service).
 * Weighted by actionAffinity × personality-vs-requirements; includes a "none"
 * option so specials stay optional. Refusal chance scales with (1 - disinhibition).
 */
export function pickTipAction(
  staffId: string,
  rng: () => number = Math.random,
  energyMoodGate: EnergyMoodGate = (a) => a,
  condition?: StaffCondition
): TipAction | null {
  const p = getPersonality(staffId);
  const entries: { action: TipAction | null; weight: number }[] = [];

  // Basic service / none — more likely when less social / less ambitious
  const noneWeight =
    0.35 +
    (1 - p.sociability) * 0.55 +
    (1 - p.ambition) * 0.25 +
    (1 - p.disinhibition) * 0.2;
  const basicBoost = condition ? basicServiceBoost(condition) : 1;
  entries.push({ action: null, weight: Math.max(0.15, noneWeight) * basicBoost });

  for (const raw of TIP_ACTIONS) {
    const gated = energyMoodGate(raw, staffId);
    if (!gated) continue;

    const affinity = p.actionAffinity[gated.id] ?? 0;
    const socF = reqFactor(p.sociability, gated.minSociability);
    const disF = reqFactor(p.disinhibition, gated.minDisinhibition);
    let w = affinity * socF * disF;

    // Ambition nudges toward specials slightly (not max-profit)
    w *= 0.65 + p.ambition * 0.5;

    // Refusal: high refusalBase + low disinhibition → near-zero weight
    const refusal = gated.refusalBase * (1 - p.disinhibition);
    w *= Math.max(0, 1 - refusal);

    // Hard floor: if affinity is tiny and requirements fail, kill it
    if (affinity < 0.08 && (socF < 0.05 || disF < 0.05)) w = 0;

    // Phase 4: energy / mood bands (effort-scaled; critical or unaffordable → 0)
    if (condition) w *= energyMoodWeight(gated, condition);

    if (w > 0.001) entries.push({ action: gated, weight: w });
  }

  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;

  let roll = rng() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) {
      // Extra refusal roll if an action was selected
      if (e.action) {
        const refusal =
          e.action.refusalBase * (1 - getPersonality(staffId).disinhibition);
        if (rng() < refusal * 0.5) return null;
      }
      return e.action;
    }
  }
  return entries[entries.length - 1]?.action ?? null;
}
