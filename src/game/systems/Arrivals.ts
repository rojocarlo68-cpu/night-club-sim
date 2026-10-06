/**
 * Prompt B Phase B4–B6 — single organic arrival scheduler.
 * Decides WHEN patrons may spawn; ClubScene.spawnPatron still creates the entity.
 *
 * Soft cap = ceiling (potential), NOT a fill target.
 */

import {
  EARLY_NIGHT_SOFT_CAP,
  BASE_DEMAND,
  FIRST_ARRIVAL_MIN_GAME_MINUTES,
  FIRST_ARRIVAL_MAX_GAME_MINUTES,
  MIN_INTERVAL_GAME_MINUTES,
  MAX_INTERVAL_GAME_MINUTES,
  GROUP_CHANCE,
  MAX_GROUP_SIZE,
  GROUP_STAGGER_GAME_MINUTES,
  QUIET_STRETCH_CHANCE,
  QUIET_INTERVAL_MULT,
  QUIET_MIN_GAME_MINUTES,
  STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC,
  HOUR_DEMAND_MULT,
  INTERVAL_JITTER_GAME_MINUTES,
  LATE_OPEN_PENALTY_PER_GAME_HOUR,
  MIN_SOFT_CAP,
  earlyNightDemandScale,
  getDemandModifiersProduct,
  demandModifiers,
  getLoyalSoftCapBonus,
} from '../config/demand';
import { formatGameClock, getShiftState, type ShiftState } from './Shift';
import { RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE } from '../config/shift';

export interface ArrivalLogEntry {
  hhmm: string;
  gameHour: number;
  gameMinute: number;
  count: number;
  kind: 'solo' | 'group';
}

export interface ArrivalsTickContext {
  gameHour: number;
  gameMinute: number;
  /** @deprecated B7 — pass Infinity when nightTimer is removed. */
  nightTimerSec: number;
  shiftState?: ShiftState;
  /** Present staff count — hook for future demand scaling. */
  staffCount?: number;
}

let rngState = (Date.now() % 1000000000) + 1;
let spawnedTonight = 0;
let softCap = EARLY_NIGHT_SOFT_CAP;
let demandScale = 1;
let lateOpenPenalty = 0;
let nextDueAbsMin: number | null = null;
let pendingGroupExtra = 0;
let arrivalsActive = false;
let openAbsMin = 18 * 60;
let nightIndex = 1;
const arrivalLog: ArrivalLogEntry[] = [];
const spawnAbsTimes: number[] = [];

function lcg(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

export function setArrivalsSeed(seed: number): void {
  // Mix seed so nearby integers diverge on the first rolls (B5 RNG fix).
  const s = Math.floor(seed) >>> 0;
  rngState = (Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
  // Warm a few steps so the first consumer isn't correlated across seeds.
  lcg();
  lcg();
}

function randUnit(): number {
  return lcg();
}

function randInt(min: number, max: number): number {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(randUnit() * (b - a + 1));
}

function absMin(hour: number, minute: number): number {
  return (
    (((Math.floor(hour) % 24) + 24) % 24) * 60 + Math.max(0, Math.min(59, Math.floor(minute)))
  );
}

function nowAbsContinuous(hour: number, minute: number): number {
  let now = absMin(hour, minute);
  if (now < openAbsMin - 12 * 60) {
    now += 24 * 60;
  }
  return now;
}

function hourMult(hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = HOUR_DEMAND_MULT[h];
  return typeof m === 'number' && m > 0 ? m : 1;
}

function rollFirstArrivalDelay(): number {
  // Two-sample mix so the full 2–12 range is hit across seeds (B5).
  const u = (randUnit() * 0.61 + randUnit() * 0.39) % 1;
  const a = FIRST_ARRIVAL_MIN_GAME_MINUTES;
  const b = FIRST_ARRIVAL_MAX_GAME_MINUTES;
  return a + Math.floor(u * (b - a + 1));
}

function rollIntervalGameMinutes(atHour: number): number {
  let span = randInt(MIN_INTERVAL_GAME_MINUTES, MAX_INTERVAL_GAME_MINUTES);
  const mult =
    hourMult(atHour) *
    Math.max(0.25, BASE_DEMAND) *
    Math.max(0.25, demandScale) *
    getDemandModifiersProduct();
  // Higher demand → shorter gaps; early-night low scale → longer gaps
  span = Math.round(span / mult);
  if (randUnit() < QUIET_STRETCH_CHANCE) {
    span = Math.max(QUIET_MIN_GAME_MINUTES, Math.round(span * QUIET_INTERVAL_MULT));
  }
  if (INTERVAL_JITTER_GAME_MINUTES > 0) {
    span += randInt(-INTERVAL_JITTER_GAME_MINUTES, INTERVAL_JITTER_GAME_MINUTES);
  }
  return Math.max(MIN_INTERVAL_GAME_MINUTES, span);
}

function scheduleNextAfter(fromAbs: number, atHour: number): void {
  const gap = rollIntervalGameMinutes(atHour);
  nextDueAbsMin = fromAbs + gap;
}

function computeSoftCap(nightNumber: number, openHour: number, openMinute: number): {
  cap: number;
  scale: number;
  latePenalty: number;
} {
  const scale = earlyNightDemandScale(nightNumber);
  // Hidden demand (reputation) scales the CEILING; loyal returning customers add a little.
  let cap = Math.round(EARLY_NIGHT_SOFT_CAP * scale * getDemandModifiersProduct()) + getLoyalSoftCapBonus();
  // Late-open hook: only when clock is past recommended open at Abrir.
  const openAbs = absMin(openHour, openMinute);
  const recommendedAbs = absMin(RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE);
  let latePenalty = 0;
  if (openAbs > recommendedAbs) {
    const hoursLate = (openAbs - recommendedAbs) / 60;
    latePenalty = Math.floor(hoursLate) * LATE_OPEN_PENALTY_PER_GAME_HOUR;
    cap -= latePenalty;
  }
  cap = Math.max(MIN_SOFT_CAP, cap);
  return { cap, scale, latePenalty };
}

/**
 * Start a night of arrivals. Call once from openNight after shift is OPEN.
 */
export function beginArrivalsNight(
  openHour: number,
  openMinute: number,
  staffCount: number,
  nightNumber = 1
): void {
  // B11: staffCount reserved for absence/capacity; demandModifiers stub applied in intervals.
  void staffCount;
  nightIndex = Math.max(1, Math.floor(nightNumber) || 1);
  const computed = computeSoftCap(nightIndex, openHour, openMinute);
  demandScale = computed.scale;
  lateOpenPenalty = computed.latePenalty;
  softCap = computed.cap;
  spawnedTonight = 0;
  pendingGroupExtra = 0;
  arrivalsActive = true;
  arrivalLog.length = 0;
  spawnAbsTimes.length = 0;
  openAbsMin = absMin(openHour, openMinute);
  const delay = rollFirstArrivalDelay();
  nextDueAbsMin = openAbsMin + delay;
}

export function stopArrivals(): void {
  arrivalsActive = false;
  nextDueAbsMin = null;
  pendingGroupExtra = 0;
}

function canAcceptMore(nightTimerSec: number, shiftState: ShiftState): boolean {
  if (!arrivalsActive) return false;
  if (shiftState === 'closing' || shiftState === 'summary' || shiftState === 'closed') {
    return false;
  }
  // B7 will stop passing a finite nightTimer; treat non-finite / huge as "no timer limit".
  if (
    Number.isFinite(nightTimerSec) &&
    nightTimerSec < STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC
  ) {
    return false;
  }
  if (spawnedTonight >= softCap) return false;
  return true;
}

export function tickArrivals(ctx: ArrivalsTickContext): number {
  const shiftState = ctx.shiftState ?? getShiftState();
  if (!canAcceptMore(ctx.nightTimerSec, shiftState)) {
    if (
      spawnedTonight >= softCap ||
      (Number.isFinite(ctx.nightTimerSec) &&
        ctx.nightTimerSec < STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC)
    ) {
      arrivalsActive = false;
    }
    return 0;
  }
  if (nextDueAbsMin == null) return 0;

  const now = nowAbsContinuous(ctx.gameHour, ctx.gameMinute);
  if (now < nextDueAbsMin) return 0;

  spawnedTonight += 1;
  spawnAbsTimes.push(now);
  const hhmm = formatGameClock(ctx.gameHour, ctx.gameMinute);

  if (pendingGroupExtra > 0) {
    pendingGroupExtra -= 1;
    arrivalLog.push({
      hhmm,
      gameHour: ctx.gameHour,
      gameMinute: ctx.gameMinute,
      count: 1,
      kind: 'group',
    });
    if (pendingGroupExtra > 0) {
      nextDueAbsMin = now + Math.max(0, GROUP_STAGGER_GAME_MINUTES);
    } else if (spawnedTonight >= softCap) {
      arrivalsActive = false;
      nextDueAbsMin = null;
    } else {
      scheduleNextAfter(now, ctx.gameHour);
    }
    return 1;
  }

  const roomForGroup =
    MAX_GROUP_SIZE > 1 && spawnedTonight + (MAX_GROUP_SIZE - 1) <= softCap;
  const isGroup = roomForGroup && randUnit() < GROUP_CHANCE;

  arrivalLog.push({
    hhmm,
    gameHour: ctx.gameHour,
    gameMinute: ctx.gameMinute,
    count: isGroup ? MAX_GROUP_SIZE : 1,
    kind: isGroup ? 'group' : 'solo',
  });

  if (isGroup) {
    pendingGroupExtra = MAX_GROUP_SIZE - 1;
    nextDueAbsMin = now + Math.max(0, GROUP_STAGGER_GAME_MINUTES);
  } else if (spawnedTonight >= softCap) {
    arrivalsActive = false;
    nextDueAbsMin = null;
  } else {
    scheduleNextAfter(now, ctx.gameHour);
  }

  return 1;
}

export function getArrivalsDebug() {
  const intervals: number[] = [];
  for (let i = 1; i < spawnAbsTimes.length; i++) {
    intervals.push(spawnAbsTimes[i] - spawnAbsTimes[i - 1]);
  }
  const quietSpans = intervals.filter((x) => x >= QUIET_MIN_GAME_MINUTES);
  return {
    spawnedTonight,
    softCap,
    /** Ceiling constant — not a fill target. */
    earlyNightSoftCap: EARLY_NIGHT_SOFT_CAP,
    softCapIsCeilingNotTarget: true,
    demandScale,
    lateOpenPenalty,
    nightIndex,
    baseDemand: BASE_DEMAND,
    demandModifiers: { ...demandModifiers },
    demandModifiersProduct: getDemandModifiersProduct(),
    arrivalsActive,
    nextDueAbsMin,
    pendingGroupExtra,
    openAbsMin,
    firstArrivalRange: [FIRST_ARRIVAL_MIN_GAME_MINUTES, FIRST_ARRIVAL_MAX_GAME_MINUTES] as [
      number,
      number,
    ],
    firstArrivalDelayScheduled:
      nextDueAbsMin != null && spawnAbsTimes.length === 0
        ? nextDueAbsMin - openAbsMin
        : spawnAbsTimes.length > 0
          ? spawnAbsTimes[0] - openAbsMin
          : null,
    intervalRange: [MIN_INTERVAL_GAME_MINUTES, MAX_INTERVAL_GAME_MINUTES] as [number, number],
    groupChance: GROUP_CHANCE,
    maxGroupSize: MAX_GROUP_SIZE,
    quietStretchChance: QUIET_STRETCH_CHANCE,
    quietMinGameMinutes: QUIET_MIN_GAME_MINUTES,
    arrivalLog: arrivalLog.map((e) => ({ ...e })),
    spawnAbsTimes: [...spawnAbsTimes],
    intervalsGameMinutes: intervals,
    quietSpansGameMinutes: quietSpans,
    stopBelowNightTimerSec: STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC,
  };
}

export function getSpawnedTonight(): number {
  return spawnedTonight;
}

/**
 * Test/debug: simulate the arrival scheduler for one virtual night (no entities, no side effects
 * on the live scheduler state) and return how many arrivals it would produce.
 */
export function simulateArrivalsCount(opts: {
  seed: number;
  nightNumber: number;
  openHour?: number;
  openMinute?: number;
  durationMinutes?: number;
}): number {
  const saved = {
    rngState, spawnedTonight, softCap, demandScale, lateOpenPenalty, nextDueAbsMin,
    pendingGroupExtra, arrivalsActive, openAbsMin, nightIndex,
    log: arrivalLog.splice(0), times: spawnAbsTimes.splice(0),
  };
  try {
    setArrivalsSeed(opts.seed);
    const oh = opts.openHour ?? 18;
    const om = opts.openMinute ?? 0;
    beginArrivalsNight(oh, om, 2, opts.nightNumber);
    let n = 0;
    const dur = opts.durationMinutes ?? 8 * 60;
    for (let m = 0; m <= dur; m++) {
      const t = oh * 60 + om + m;
      n += tickArrivals({
        gameHour: Math.floor(t / 60) % 24,
        gameMinute: t % 60,
        nightTimerSec: Number.POSITIVE_INFINITY,
        shiftState: 'open',
      });
    }
    return n;
  } finally {
    rngState = saved.rngState; spawnedTonight = saved.spawnedTonight; softCap = saved.softCap;
    demandScale = saved.demandScale; lateOpenPenalty = saved.lateOpenPenalty; nextDueAbsMin = saved.nextDueAbsMin;
    pendingGroupExtra = saved.pendingGroupExtra; arrivalsActive = saved.arrivalsActive;
    openAbsMin = saved.openAbsMin; nightIndex = saved.nightIndex;
    arrivalLog.length = 0; arrivalLog.push(...saved.log);
    spawnAbsTimes.length = 0; spawnAbsTimes.push(...saved.times);
  }
}
