/**
 * Hidden per-patron-identity × staff affinity (Phase 5).
 * Lazily rolled and cached. Staff AI must NEVER call these for decisions.
 * Only the serve-payout / outcome path applies effects.
 */

import {
  AffinityLevel,
  AFFINITY_WEIGHTS,
  AFFINITY_EFFECTS,
  AFFINITY_JITTER,
  AFFINITY_TIP_CHANCE_CAP,
  AFFINITY_LEVEL_ORDER,
} from '../config/affinity';

type StaffMap = Record<string, AffinityLevel>;
/** patronKey (stable name) → staffId → level */
type AffinityCache = Record<string, StaffMap>;

export interface AffinityDebugEntry {
  patronName: string;
  staffId: string;
  level: AffinityLevel;
  tipped: boolean;
  amount: number;
}

const DEBUG_CAP = 50;

let cache: AffinityCache = {};
const debugRing: AffinityDebugEntry[] = [];

/** Stable recurring-client key: preferred name (Kai/Mika/Ryo/Yuri), else base id. */
export function patronAffinityKey(patron: {
  profile: { name?: string; id?: string };
}): string {
  const name = (patron.profile?.name || '').trim();
  if (name) return name;
  const id = patron.profile?.id || 'unknown';
  // Strip spawn suffix `_${Date.now()}_${rand}` when present.
  const base = id.replace(/_\d+_[a-z0-9]+$/i, '');
  return base || id;
}

function rollLevel(rng: () => number): AffinityLevel {
  const r = rng();
  let acc = 0;
  for (const level of AFFINITY_LEVEL_ORDER) {
    acc += AFFINITY_WEIGHTS[level];
    if (r < acc) return level;
  }
  return 'normal';
}

/**
 * Lazily assign + cache affinity for this patron identity × staff.
 * Invisible to staff decision-making — call only from outcome/payout code.
 */
export function getAffinity(
  patron: { profile: { name?: string; id?: string } },
  staffId: string,
  rng: () => number = Math.random
): AffinityLevel {
  if (!staffId) return 'normal';
  const key = patronAffinityKey(patron);
  if (!cache[key]) cache[key] = {};
  const existing = cache[key][staffId];
  if (existing) return existing;
  const level = rollLevel(rng);
  cache[key][staffId] = level;
  return level;
}

export interface AffinityTipMods {
  tipChance: number;
  tipAmountMult: number;
  satisfactionBonus: number;
  level: AffinityLevel;
}

/**
 * Apply affinity modifiers + jitter to a tip chance / amount mult.
 * Chance is clamped to [0, AFFINITY_TIP_CHANCE_CAP].
 */
export function applyAffinityToTipChance(
  tipChance: number,
  level: AffinityLevel,
  rng: () => number = Math.random
): AffinityTipMods {
  const fx = AFFINITY_EFFECTS[level];
  const chanceJitter = (rng() * 2 - 1) * AFFINITY_JITTER.chanceAbs;
  const amountJitter = 1 + (rng() * 2 - 1) * AFFINITY_JITTER.amountFrac;
  const chance = Math.max(
    0,
    Math.min(AFFINITY_TIP_CHANCE_CAP, tipChance + fx.tipChanceBonus + chanceJitter)
  );
  return {
    tipChance: chance,
    tipAmountMult: fx.tipAmountMult * amountJitter,
    satisfactionBonus: fx.satisfactionBonus,
    level,
  };
}

/**
 * Boost / reduce patron nightMood (derived from patienceRemaining / patienceMax).
 * Uses the existing patience fields — no parallel mood system.
 */
export function applySatisfactionBonus(
  patron: { patienceRemaining: number; patienceMax: number },
  bonusPoints: number
): void {
  if (!bonusPoints || !Number.isFinite(bonusPoints)) return;
  const max = Math.max(1, patron.patienceMax);
  const delta = (bonusPoints / 100) * max;
  patron.patienceRemaining = Math.max(0, Math.min(max, patron.patienceRemaining + delta));
}

/** Record a served outcome for debug inspection (ring buffer ~50). */
export function pushAffinityDebug(entry: AffinityDebugEntry): void {
  debugRing.push(entry);
  while (debugRing.length > DEBUG_CAP) debugRing.shift();
}

export function getAffinityDebug(): AffinityDebugEntry[] {
  return debugRing.map((e) => ({ ...e }));
}

/** Persistable snapshot (patronName → staffId → level). */
export function serializeAffinities(): AffinityCache {
  const out: AffinityCache = {};
  for (const [pk, staffMap] of Object.entries(cache)) {
    out[pk] = { ...staffMap };
  }
  return out;
}

/** Load from save; corrupt entries skipped. */
export function loadAffinities(raw: unknown): void {
  cache = {};
  if (!raw || typeof raw !== 'object') return;
  const valid = new Set<AffinityLevel>(['baja', 'normal', 'alta']);
  for (const [pk, staffMap] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof pk !== 'string' || !pk || !staffMap || typeof staffMap !== 'object') continue;
    const row: StaffMap = {};
    for (const [sid, lvl] of Object.entries(staffMap as Record<string, unknown>)) {
      if (typeof sid !== 'string' || !sid) continue;
      if (typeof lvl === 'string' && valid.has(lvl as AffinityLevel)) {
        row[sid] = lvl as AffinityLevel;
      }
    }
    if (Object.keys(row).length) cache[pk] = row;
  }
}

/** Test helper: clear cache + debug ring. */
export function resetAffinitiesForTests(): void {
  cache = {};
  debugRing.length = 0;
}
