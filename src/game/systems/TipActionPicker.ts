/**
 * Personality-driven tip-action picker (Phase 3).
 * Does NOT pick max-profit — weights follow affinity + requirements + refusal.
 * Energy/mood gating is a Phase 4 hook (identity by default).
 */

import { getPersonality } from '../config/personality';
import { TIP_ACTIONS, TipAction } from '../config/tipActions';

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

/**
 * Pick a tip action (or null = basic service).
 * Weighted by actionAffinity × personality-vs-requirements; includes a "none"
 * option so specials stay optional. Refusal chance scales with (1 - disinhibition).
 */
export function pickTipAction(
  staffId: string,
  rng: () => number = Math.random,
  energyMoodGate: EnergyMoodGate = (a) => a
): TipAction | null {
  const p = getPersonality(staffId);
  const entries: { action: TipAction | null; weight: number }[] = [];

  // Basic service / none — more likely when less social / less ambitious
  const noneWeight =
    0.35 +
    (1 - p.sociability) * 0.55 +
    (1 - p.ambition) * 0.25 +
    (1 - p.disinhibition) * 0.2;
  entries.push({ action: null, weight: Math.max(0.15, noneWeight) });

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
