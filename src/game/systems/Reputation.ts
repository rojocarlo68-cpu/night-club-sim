/**
 * Prompt A Phase 10: prepared reputation / return-chance store.
 * Records final visit sat per patron name via onVisitFinished.
 *
 * TODO: getReturnChanceHint() is NOT used by spawnPatron / chooseMainPatronGoal yet.
 * Wire later when return visits become a spawn weight.
 */

import { REPUTATION_VISIT_CAP, RETURN_CHANCE } from '../config/reputation';
import {
  onVisitFinishedCallback,
  type VisitRecord,
} from './CustomerExperience';
import { noteNightVisitSatisfaction } from './NightStats';

type SatHistory = Record<string, number[]>;

let byName: SatHistory = {};
let installed = false;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function noteVisitOutcome(record: VisitRecord): void {
  const name = (record.name || record.patronKey || '').trim();
  if (!name) return;
  if (!byName[name]) byName[name] = [];
  byName[name].push(record.satisfaction);
  while (byName[name].length > REPUTATION_VISIT_CAP) byName[name].shift();
  // Also feed tonight's avg sat accumulator (Phase 10 night log).
  noteNightVisitSatisfaction(record.satisfaction);
}

/**
 * Hint of return probability from recent visit sats (0..1).
 * TODO: not consumed by spawning — placeholder for future reputation system.
 */
export function getReturnChanceHint(patronName: string): number {
  const name = (patronName || '').trim();
  const hist = name ? byName[name] : undefined;
  if (!hist || !hist.length) return RETURN_CHANCE.defaultWhenUnknown;
  const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
  // Piecewise linear 0→50→100
  if (avg <= 50) {
    const t = avg / 50;
    return clamp01(
      RETURN_CHANCE.atSat0 + (RETURN_CHANCE.atSat50 - RETURN_CHANCE.atSat0) * t
    );
  }
  const t = (avg - 50) / 50;
  return clamp01(
    RETURN_CHANCE.atSat50 + (RETURN_CHANCE.atSat100 - RETURN_CHANCE.atSat50) * t
  );
}

export function serializeReputation(): SatHistory {
  const out: SatHistory = {};
  for (const [k, v] of Object.entries(byName)) out[k] = [...v];
  return out;
}

export function loadReputation(raw: unknown): void {
  byName = {};
  if (!raw || typeof raw !== 'object') return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k || !Array.isArray(v)) continue;
    const nums = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (nums.length) byName[k] = nums.slice(-REPUTATION_VISIT_CAP);
  }
}

/** Register finalizeVisit listener once (safe to call repeatedly). */
export function installReputationHook(): void {
  if (installed) return;
  installed = true;
  onVisitFinishedCallback((r) => noteVisitOutcome(r));
}

export function getReputationDebug() {
  const out: Record<string, { visits: number[]; hint: number }> = {};
  for (const [k, v] of Object.entries(byName)) {
    out[k] = { visits: [...v], hint: getReturnChanceHint(k) };
  }
  return out;
}

export function resetReputationForTests(): void {
  byName = {};
}
