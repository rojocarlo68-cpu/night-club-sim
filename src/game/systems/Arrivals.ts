/**
 * Prompt B Phase B4 — single organic arrival scheduler (replaces fixed 400ms/2200ms quota).
 * Decides WHEN patrons may spawn; ClubScene.spawnPatron still creates the entity.
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
  STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC,
  HOUR_DEMAND_MULT,
  INTERVAL_JITTER_GAME_MINUTES,
} from '../config/demand';
import { formatGameClock, getShiftState, type ShiftState } from './Shift';

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
  nightTimerSec: number;
  shiftState?: ShiftState;
  /** Present staff count — hook for future demand scaling (unused in B4). */
  staffCount?: number;
}

let rngState = (Date.now() % 1000000000) + 1;
let spawnedTonight = 0;
let softCap = EARLY_NIGHT_SOFT_CAP;
let nextDueAbsMin: number | null = null;
/** Remaining companions to spawn after a group lead. */
let pendingGroupExtra = 0;
let arrivalsActive = false;
let openAbsMin = 18 * 60;
const arrivalLog: ArrivalLogEntry[] = [];
/** Absolute minutes when each patron spawned (for interval checks). */
const spawnAbsTimes: number[] = [];

function lcg(): number {
  // Numerical Recipes LCG
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

export function setArrivalsSeed(seed: number): void {
  rngState = (Math.floor(seed) >>> 0) || 1;
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
  return ((Math.floor(hour) % 24) + 24) % 24 * 60 + Math.max(0, Math.min(59, Math.floor(minute)));
}

/** Continuity across midnight relative to openAbsMin. */
function nowAbsContinuous(hour: number, minute: number): number {
  let now = absMin(hour, minute);
  if (now < openAbsMin - 12 * 60) {
    // crossed midnight after an evening open
    now += 24 * 60;
  }
  return now;
}

function hourMult(hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = HOUR_DEMAND_MULT[h];
  return typeof m === 'number' && m > 0 ? m : 1;
}

function rollIntervalGameMinutes(atHour: number): number {
  let span = randInt(MIN_INTERVAL_GAME_MINUTES, MAX_INTERVAL_GAME_MINUTES);
  const mult = hourMult(atHour) * Math.max(0.25, BASE_DEMAND);
  // Higher demand → shorter gaps
  span = Math.round(span / mult);
  if (randUnit() < QUIET_STRETCH_CHANCE) {
    span = Math.round(span * QUIET_INTERVAL_MULT);
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

/**
 * Start a night of arrivals. Call once from openNight after shift is OPEN.
 * @param staffCount Luna+Nova (+hired) — reserved for B5+ demand scaling.
 */
export function beginArrivalsNight(
  openHour: number,
  openMinute: number,
  staffCount: number
): void {
  // B5+/B11: scale softCap / intervals using staffCount + club development.
  void staffCount;
  spawnedTonight = 0;
  softCap = EARLY_NIGHT_SOFT_CAP;
  pendingGroupExtra = 0;
  arrivalsActive = true;
  arrivalLog.length = 0;
  spawnAbsTimes.length = 0;
  openAbsMin = absMin(openHour, openMinute);
  const delay = randInt(FIRST_ARRIVAL_MIN_GAME_MINUTES, FIRST_ARRIVAL_MAX_GAME_MINUTES);
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
  if (nightTimerSec < STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC) return false;
  if (spawnedTonight >= softCap) return false;
  return true;
}

/**
 * Process due arrivals at the current game clock.
 * @returns how many patrons ClubScene should spawn right now (usually 0 or 1).
 */
export function tickArrivals(ctx: ArrivalsTickContext): number {
  const shiftState = ctx.shiftState ?? getShiftState();
  if (!canAcceptMore(ctx.nightTimerSec, shiftState)) {
    if (spawnedTonight >= softCap || ctx.nightTimerSec < STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC) {
      arrivalsActive = false;
    }
    return 0;
  }
  if (nextDueAbsMin == null) return 0;

  const now = nowAbsContinuous(ctx.gameHour, ctx.gameMinute);
  if (now < nextDueAbsMin) return 0;

  // One spawn event per tick call (group extras get their own due times).
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

  // Lead of solo or group
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
  return {
    spawnedTonight,
    softCap,
    earlyNightSoftCap: EARLY_NIGHT_SOFT_CAP,
    baseDemand: BASE_DEMAND,
    arrivalsActive,
    nextDueAbsMin,
    pendingGroupExtra,
    openAbsMin,
    firstArrivalRange: [FIRST_ARRIVAL_MIN_GAME_MINUTES, FIRST_ARRIVAL_MAX_GAME_MINUTES] as [
      number,
      number,
    ],
    intervalRange: [MIN_INTERVAL_GAME_MINUTES, MAX_INTERVAL_GAME_MINUTES] as [number, number],
    groupChance: GROUP_CHANCE,
    maxGroupSize: MAX_GROUP_SIZE,
    arrivalLog: arrivalLog.map((e) => ({ ...e })),
    spawnAbsTimes: [...spawnAbsTimes],
    intervalsGameMinutes: intervals,
    stopBelowNightTimerSec: STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC,
  };
}

export function getSpawnedTonight(): number {
  return spawnedTonight;
}
