/**
 * Staff personal money (from tips) + consumption effects (café / alcohol) + order compliance.
 * Extends existing staff stats (Bartender.profile.energy / mood) — no parallel stat system.
 */
import {
  ALCOHOL,
  AUTO_CONSUME,
  CAFFEINE,
  CONSUMABLE_EFFECTS,
  OUTSIDE_SPEND,
  consumptionProfileFor,
} from '../config/staffConsumption';
import { ORDER_COMPLIANCE } from '../config/orderCompliance';

interface NeedState {
  wallet: number;
  intox: number;
  caffeineCups: number;
  caffeineBuffUntil: number;
  caffeineCrash: number;
  autoAlcohol: number;
  nextAutoCheckAt: number;
  drinksToday: number;
}

const byStaff = new Map<string, NeedState>();
let savedWallets: Record<string, number> = {};

function ensure(id: string): NeedState {
  let s = byStaff.get(id);
  if (!s) {
    const prof = consumptionProfileFor(id);
    const saved = savedWallets[id];
    s = {
      wallet: typeof saved === 'number' && Number.isFinite(saved) ? Math.max(0, Math.floor(saved)) : prof.startMoney,
      intox: 0,
      caffeineCups: 0,
      caffeineBuffUntil: 0,
      caffeineCrash: 0,
      autoAlcohol: 0,
      nextAutoCheckAt: 0,
      drinksToday: 0,
    };
    byStaff.set(id, s);
  }
  return s;
}

export function loadStaffWallets(raw: unknown): void {
  byStaff.clear();
  savedWallets = {};
  if (!raw || typeof raw !== 'object') return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) savedWallets[k] = Math.max(0, Math.floor(v));
  }
}

export function serializeStaffWallets(): Record<string, number> {
  const out: Record<string, number> = { ...savedWallets };
  for (const [id, s] of byStaff) out[id] = Math.max(0, Math.floor(s.wallet));
  return out;
}

export function getWallet(id: string): number {
  return Math.floor(ensure(id).wallet);
}

/** Tips go to the employee's own pocket (club money flow unchanged). */
export function creditWallet(id: string, amount: number): void {
  if (!(amount > 0)) return;
  ensure(id).wallet += Math.floor(amount);
}

export function debitWallet(id: string, amount: number): boolean {
  const s = ensure(id);
  const n = Math.max(0, Math.ceil(amount));
  if (s.wallet < n) return false;
  s.wallet -= n;
  return true;
}

export function canAfford(id: string, amount: number): boolean {
  return ensure(id).wallet >= Math.ceil(amount);
}

export function intoxOf(id: string): number {
  return ensure(id).intox;
}

export function intoxLabel(id: string): string | null {
  const x = ensure(id).intox;
  if (x >= ALCOHOL.drunkAt) return 'Borracha';
  if (x >= ALCOHOL.tipsyAt) return 'Achispada';
  return null;
}

export function isCaffeinated(id: string, now: number): boolean {
  return ensure(id).caffeineBuffUntil > now;
}

export interface StatHolder {
  energy: number;
  mood: number;
}

export interface ConsumeResult {
  energyDelta: number;
  moodDelta: number;
  intox: number;
  phrase: string;
  verb: string;
}

/** Apply the effect of one unit of `productId` to the staff stats. */
export function applyConsumption(id: string, stats: StatHolder, productId: string, now: number): ConsumeResult | null {
  const fx = CONSUMABLE_EFFECTS[productId];
  if (!fx) return null;
  const s = ensure(id);
  const prof = consumptionProfileFor(id);
  let e = fx.energy;
  let m = fx.mood;
  if (fx.caffeine) {
    const boost = CAFFEINE.boost * Math.pow(CAFFEINE.diminish, s.caffeineCups);
    e += boost;
    s.caffeineCups += 1;
    s.caffeineBuffUntil = now + CAFFEINE.buffMs;
    s.caffeineCrash += CAFFEINE.crash * Math.pow(CAFFEINE.diminish, s.caffeineCups - 1);
  }
  if (fx.alcohol > 0) {
    const tol = Math.max(0.2, Math.min(1, prof.alcoholTolerance));
    s.intox = Math.min(1, s.intox + fx.alcohol * ALCOHOL.perUnit * (0.5 / tol));
    // Initial lift masks some tiredness (paid back later by energy drain).
    e += 3;
  }
  s.drinksToday += 1;
  const before = { e: stats.energy, m: stats.mood };
  stats.energy = Math.max(0, Math.min(100, stats.energy + e));
  stats.mood = Math.max(0, Math.min(100, stats.mood + m));
  return {
    energyDelta: stats.energy - before.e,
    moodDelta: stats.mood - before.m,
    intox: s.intox,
    phrase: fx.phrase,
    verb: fx.verb,
  };
}

/** Per-frame: intoxication decays, drains energy; café buff ends with a small crash. */
export function tickStaffNeeds(id: string, stats: StatHolder, dtSec: number, now: number): void {
  const s = ensure(id);
  if (s.intox > 0) {
    stats.energy = Math.max(0, stats.energy - ALCOHOL.energyDrainPerSec * s.intox * dtSec);
    s.intox = Math.max(0, s.intox - ALCOHOL.decayPerSec * dtSec);
  }
  if (s.caffeineCrash > 0 && s.caffeineBuffUntil > 0 && now >= s.caffeineBuffUntil) {
    stats.energy = Math.max(0, stats.energy - s.caffeineCrash);
    s.caffeineCrash = 0;
    s.caffeineBuffUntil = 0;
  }
}

/** Service quality factor on tip chance (drunk → worse service). */
export function serviceFactor(id: string): number {
  const x = ensure(id).intox;
  return 1 - (1 - ALCOHOL.serviceFactorAtMax) * x;
}

export function spillChance(id: string): number {
  return ensure(id).intox * ALCOHOL.spillChancePerIntox;
}

export function slowServeFactor(id: string): number {
  return 1 + (ALCOHOL.slowServeAtMax - 1) * ensure(id).intox;
}

export type Compliance = 'obey' | 'delay' | 'refuse' | 'abandon';

/** Probability she does NOT simply obey (0 at normal levels). */
export function disobeyChance(energy: number, mood: number, intox: number): number {
  const c = ORDER_COMPLIANCE;
  const eTerm = energy < c.extremeEnergy ? (c.extremeEnergy - energy) / c.extremeEnergy : 0;
  const mTerm = mood < c.extremeMood ? (c.extremeMood - mood) / c.extremeMood : 0;
  const xTerm = intox >= c.extremeIntox ? (intox - c.extremeIntox) / (1 - c.extremeIntox) : 0;
  if (eTerm <= 0 && mTerm <= 0 && xTerm <= 0) return 0;
  const p = 0.25 + 0.4 * eTerm + 0.4 * mTerm + 0.35 * xTerm;
  return Math.max(0, Math.min(c.maxDisobey, p));
}

export function rollCompliance(id: string, energy: number, mood: number, rng: () => number = Math.random): Compliance {
  const p = disobeyChance(energy, mood, intoxOf(id));
  if (p <= 0 || rng() >= p) return 'obey';
  const w = ORDER_COMPLIANCE.outcomeWeights;
  const r = rng() * (w.refuse + w.delay + w.abandon);
  if (r < w.refuse) return 'refuse';
  if (r < w.refuse + w.delay) return 'delay';
  return 'abandon';
}

/** Autonomous purchase decision (idle priority). Returns product id or null. */
export function pickAutoConsumption(
  id: string,
  stats: StatHolder,
  now: number,
  shiftMinutes: number,
  inStock: (pid: string) => boolean,
  priceOf: (pid: string) => number,
  rng: () => number = Math.random
): string | null {
  const s = ensure(id);
  if (now < s.nextAutoCheckAt) return null;
  s.nextAutoCheckAt = now + AUTO_CONSUME.checkEveryMs * (0.75 + rng() * 0.5);
  const prof = consumptionProfileFor(id);
  const tired = stats.energy < AUTO_CONSUME.tiredEnergy;
  const sad = stats.mood < AUTO_CONSUME.lowMood;
  const need = 1 + (tired ? 0.8 : 0) + (sad ? 0.5 : 0);
  const chance =
    AUTO_CONSUME.baseChance * need * (0.4 + prof.spendRate) * (1 + Math.max(0, shiftMinutes) * AUTO_CONSUME.perShiftMinute / 10);
  if (rng() >= Math.min(0.6, chance)) return null;
  const opts: Array<{ pid: string; w: number }> = [];
  for (const [pid, like] of Object.entries(prof.prefs)) {
    const fx = CONSUMABLE_EFFECTS[pid];
    if (!fx || !inStock(pid)) continue;
    const price = priceOf(pid);
    if (s.wallet < price) continue;
    // Savers avoid spending a big share of their pocket.
    if (price > s.wallet * (0.3 + prof.spendRate)) continue;
    let w = like;
    if (fx.caffeine && tired) w *= 2.2;
    if (fx.alcohol > 0) {
      if (s.intox >= AUTO_CONSUME.maxAutoIntox || s.autoAlcohol >= prof.autoAlcoholCap) continue;
      if (sad) w *= 1.6;
    }
    if (w > 0.02) opts.push({ pid, w });
  }
  if (!opts.length) return null;
  const total = opts.reduce((a, o) => a + o.w, 0);
  let r = rng() * total;
  for (const o of opts) {
    r -= o.w;
    if (r <= 0) return o.pid;
  }
  return opts[opts.length - 1].pid;
}

export function noteAutoConsumption(id: string, productId: string): void {
  const fx = CONSUMABLE_EFFECTS[productId];
  if (fx && fx.alcohol > 0) ensure(id).autoAlcohol += 1;
}

/** Dormir: sober up, reset café/alcohol counters; they spend part of their money outside. */
export function onStaffSleep(ids: string[], rng: () => number = Math.random): void {
  for (const id of ids) {
    const s = ensure(id);
    const prof = consumptionProfileFor(id);
    s.intox = 0;
    s.caffeineCups = 0;
    s.caffeineBuffUntil = 0;
    s.caffeineCrash = 0;
    s.autoAlcohol = 0;
    s.drinksToday = 0;
    const frac = OUTSIDE_SPEND.min + rng() * (OUTSIDE_SPEND.max - OUTSIDE_SPEND.min);
    s.wallet = Math.max(0, Math.floor(s.wallet - s.wallet * frac * prof.spendRate * 2));
  }
}

export function getStaffNeedsDebug() {
  const out: Record<string, NeedState> = {};
  for (const [id, s] of byStaff) out[id] = { ...s };
  return out;
}

/** Test/debug: force intoxication. */
export function debugSetIntox(id: string, v: number): void {
  ensure(id).intox = Math.max(0, Math.min(1, v));
}
export function debugSetWallet(id: string, v: number): void {
  ensure(id).wallet = Math.max(0, Math.floor(v));
}

// ─── Save slots (pause menu): exact live state of this module (versioned by SaveSlots). ───

export function exportStaffNeedsLive(): Record<string, NeedState> {
  const out: Record<string, NeedState> = {};
  for (const [id, s] of byStaff) out[id] = { ...s };
  return out;
}

/** Wallet, alcohol, café buff/crash timers (scene-clock ms; the sim clock is restored too). */
export function importStaffNeedsLive(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [id, v] of Object.entries(raw as Record<string, Partial<NeedState>>)) {
    if (!v || typeof v !== 'object') continue;
    const s = ensure(id);
    for (const k of Object.keys(s) as (keyof NeedState)[]) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) s[k] = x;
    }
  }
}
