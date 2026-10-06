/**
 * Prompt A Phase 10: reputation / return-chance store (per patron name, via onVisitFinished).
 * Demand stage: extended with the HIDDEN club reputation (inertia, updated once per night) and a
 * lightweight returning-visitor pool. Nothing here is ever shown to the player as a number.
 */

import {
  REPUTATION_VISIT_CAP,
  RETURN_CHANCE,
  CLUB_REPUTATION,
  NIGHT_QUALITY,
  REPUTATION_DEMAND_MULT,
  RETURNING,
} from '../config/reputation';
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

/* ───────────── Hidden club reputation (demand with inertia) ───────────── */

/** Everything the night actually produced (assembled by ClubScene at night end). */
export interface NightQualityInputs {
  visits: number;
  avgSatisfaction: number | null;
  unhappyExits: number;
  leftWithoutBuy: number;
  stockouts: number;
  brokenUnrepaired: number;
  floorTrash: number;
  fullBagLying: boolean;
  avgStaffEnergy: number | null;
  /** 0..1 — venue amenities (seats / comfort / decor / entertainment / variety). */
  amenities: number;
}

export interface ClubReputationState {
  value: number;
  goodStreak: number;
  badStreak: number;
  history: Array<{ night: number; quality: number | null; before: number; after: number; visits: number }>;
}

let club: ClubReputationState = { value: CLUB_REPUTATION.start, goodStreak: 0, badStreak: 0, history: [] };

function clampRep(v: number): number {
  return Math.max(CLUB_REPUTATION.min, Math.min(CLUB_REPUTATION.max, v));
}

/** 0..100 quality of what customers lived tonight (null when nobody came). */
export function computeNightQuality(i: NightQualityInputs): number | null {
  if (!(i.visits > 0) || i.avgSatisfaction == null) return null;
  const Q = NIGHT_QUALITY;
  let q = 50 + (i.avgSatisfaction - Q.satPivot) * Q.satGain;
  q -= Q.unhappyShareWeight * Math.min(1, i.unhappyExits / i.visits);
  q -= Q.leftWithoutBuyWeight * Math.min(1, i.leftWithoutBuy / i.visits);
  q -= Math.min(Q.stockoutCap, i.stockouts * Q.stockoutEach);
  q -= Math.min(Q.brokenCap, i.brokenUnrepaired * Q.brokenEach);
  q -= Math.min(Q.trashCap, Math.max(0, i.floorTrash - Q.trashFree) * Q.trashEach);
  if (i.fullBagLying) q -= Q.fullBag;
  if (i.avgStaffEnergy != null && i.avgStaffEnergy < Q.exhaustedBelow) q -= Q.exhausted;
  q += Q.amenityMax * Math.max(0, Math.min(1, i.amenities));
  return Math.max(0, Math.min(100, q));
}

/**
 * Night end: move the hidden reputation toward tonight's quality — bounded, evidence-weighted,
 * streak-compounded. Returns the applied delta.
 */
export function applyNightToClubReputation(night: number, i: NightQualityInputs): number {
  const C = CLUB_REPUTATION;
  const before = club.value;
  const q = computeNightQuality(i);
  let delta = 0;
  if (q == null) {
    // Empty night: no punishment; tiny drift toward what the venue offers by itself.
    const target = 40 + 20 * Math.max(0, Math.min(1, i.amenities));
    delta = (target - before) * C.emptyNightDrift;
    delta = Math.max(-1, Math.min(1, delta));
    club.goodStreak = 0;
    club.badStreak = 0;
  } else {
    if (q >= C.goodAt) {
      club.goodStreak += 1;
      club.badStreak = 0;
    } else if (q <= C.badAt) {
      club.badStreak += 1;
      club.goodStreak = 0;
    } else {
      club.goodStreak = 0;
      club.badStreak = 0;
    }
    const streak = Math.max(club.goodStreak, club.badStreak);
    const boost = 1 + C.streakBoostPerNight * Math.min(C.streakBoostCap, Math.max(0, streak - 1));
    const evidence = Math.min(1, i.visits / C.evidenceVisits);
    delta = (q - before) * C.alpha * boost * evidence;
    const capUp = C.maxUpPerNight * (club.goodStreak > 1 ? boost : 1);
    const capDown = C.maxDownPerNight * (club.badStreak > 1 ? boost : 1);
    delta = Math.max(-capDown, Math.min(capUp, delta));
  }
  club.value = clampRep(before + delta);
  club.history.push({ night, quality: q == null ? null : Math.round(q * 10) / 10, before: Math.round(before * 10) / 10, after: Math.round(club.value * 10) / 10, visits: i.visits });
  while (club.history.length > 30) club.history.shift();
  return club.value - before;
}

export function getClubReputation(): number {
  return club.value;
}

/** Reputation → arrival multiplier (piecewise linear 0 → 50 → 100). */
export function reputationDemandMultiplier(value: number = club.value): number {
  const M = REPUTATION_DEMAND_MULT;
  const v = clampRep(value);
  if (v <= 50) return M.at0 + (M.at50 - M.at0) * (v / 50);
  return M.at50 + (M.at100 - M.at50) * ((v - 50) / 50);
}

/** Test / debug only. */
export function debugSetClubReputation(v: number): void {
  club.value = clampRep(v);
  club.goodStreak = 0;
  club.badStreak = 0;
}

/* ───────────── Returning visitors (hook) ───────────── */

export interface ReturnIntent {
  name: string;
  favStaffId: string | null;
  sinceNight: number;
}

let returningPool: ReturnIntent[] = [];

/**
 * Visit ended: roll a hidden return intent (recent satisfaction history + affinity bonus).
 * Probability is never shown and never guaranteed.
 */
export function noteReturnIntent(
  name: string,
  satisfaction: number,
  night: number,
  favStaffId: string | null,
  rng: () => number = Math.random
): boolean {
  const n = (name || '').trim();
  if (!n || !Number.isFinite(satisfaction) || satisfaction < RETURNING.minSat) return false;
  let chance = getReturnChanceHint(n);
  if (favStaffId) chance += RETURNING.affinityBonus;
  if (rng() >= Math.min(0.95, chance)) return false;
  returningPool = returningPool.filter((r) => r.name !== n);
  returningPool.push({ name: n, favStaffId, sinceNight: night });
  while (returningPool.length > RETURNING.poolCap) returningPool.shift();
  return true;
}

/** New night: drop stale intentions. */
export function expireReturnIntents(night: number): void {
  returningPool = returningPool.filter((r) => night - r.sinceNight <= RETURNING.expireNights);
}

/** Arrival: maybe take a returning customer from the pool (removes the intention). */
export function takeReturningVisitor(rng: () => number = Math.random): ReturnIntent | null {
  if (!returningPool.length || rng() >= RETURNING.pickChance) return null;
  const i = Math.floor(rng() * returningPool.length);
  const [r] = returningPool.splice(i, 1);
  return r ?? null;
}

export function returningPoolSize(): number {
  return returningPool.length;
}

/* ───────────── Save / debug ───────────── */

export interface ClubReputationSave {
  value?: number;
  goodStreak?: number;
  badStreak?: number;
  history?: ClubReputationState['history'];
  returning?: ReturnIntent[];
}

export function serializeClubReputation(): ClubReputationSave {
  return {
    value: club.value,
    goodStreak: club.goodStreak,
    badStreak: club.badStreak,
    history: club.history.map((h) => ({ ...h })),
    returning: returningPool.map((r) => ({ ...r })),
  };
}

export function loadClubReputation(raw: unknown): void {
  club = { value: CLUB_REPUTATION.start, goodStreak: 0, badStreak: 0, history: [] };
  returningPool = [];
  if (!raw || typeof raw !== 'object') return;
  const o = raw as ClubReputationSave;
  if (typeof o.value === 'number' && Number.isFinite(o.value)) club.value = clampRep(o.value);
  if (typeof o.goodStreak === 'number') club.goodStreak = Math.max(0, Math.floor(o.goodStreak));
  if (typeof o.badStreak === 'number') club.badStreak = Math.max(0, Math.floor(o.badStreak));
  if (Array.isArray(o.history)) club.history = o.history.filter((h) => h && typeof h.night === 'number').slice(-30);
  if (Array.isArray(o.returning)) {
    returningPool = o.returning
      .filter((r) => r && typeof r.name === 'string' && typeof r.sinceNight === 'number')
      .map((r) => ({ name: r.name, favStaffId: typeof r.favStaffId === 'string' ? r.favStaffId : null, sinceNight: r.sinceNight }))
      .slice(-RETURNING.poolCap);
  }
}

export function getClubReputationDebug() {
  return {
    value: club.value,
    goodStreak: club.goodStreak,
    badStreak: club.badStreak,
    demandMultiplier: reputationDemandMultiplier(),
    history: club.history.map((h) => ({ ...h })),
    returningPool: returningPool.map((r) => ({ ...r })),
  };
}
