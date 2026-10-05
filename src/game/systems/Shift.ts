/**
 * Prompt B Phase B1–B2 — day / game clock / shift state (single source of truth).
 *
 * B2 clock policy (documented):
 * - While CLOSED: clock frozen at day-start PRE_OPEN (17:00).
 * - On Abrir (beginShiftOpen): snap clock to recommended open 18:00, then tick.
 * - While OPEN or CLOSING: advance by REAL_SECONDS_PER_GAME_MINUTE.
 * - Does NOT auto-close at 02:00 (legacy 75s nightTimer still ends the night until B7).
 *
 * Maps to existing NightPhase:
 *   closed  ↔ prep
 *   open    ↔ open
 *   closing ↔ (reserved B7; treated as open for patrons)
 *   summary ↔ summary
 */

import {
  PRE_OPEN_HOUR,
  PRE_OPEN_MINUTE,
  RECOMMENDED_CLOSE_HOUR,
  RECOMMENDED_CLOSE_MINUTE,
  RECOMMENDED_OPEN_HOUR,
  RECOMMENDED_OPEN_MINUTE,
  REAL_SECONDS_PER_GAME_MINUTE,
  CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND,
  SCHEDULE_LABEL,
  SCHEDULE_LABEL_MOBILE,
  SCHEDULE_RANGE_SHORT,
} from '../config/shift';

export type ShiftState = 'closed' | 'open' | 'closing' | 'summary';

/** Legacy ClubScene phase strings driven by shiftState. */
export type LegacyNightPhase = 'prep' | 'open' | 'summary';

export interface ShiftSnapshot {
  currentDay: number;
  gameHour: number;
  gameMinute: number;
  shiftState: ShiftState;
}

export interface ShiftPersist {
  currentDay?: number;
  gameHour?: number;
  gameMinute?: number;
  shiftState?: ShiftState;
}

const ALLOWED: Record<ShiftState, readonly ShiftState[]> = {
  closed: ['open'],
  open: ['closing', 'summary'],
  closing: ['summary'],
  summary: ['open', 'closed'],
};

let currentDay = 1;
let gameHour = PRE_OPEN_HOUR;
let gameMinute = PRE_OPEN_MINUTE;
let shiftState: ShiftState = 'closed';
/** Fractional real-seconds accumulator toward the next game minute. */
let clockAccumSec = 0;

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return PRE_OPEN_HOUR;
  return ((Math.floor(h) % 24) + 24) % 24;
}

function clampMinute(m: number): number {
  if (!Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(59, Math.floor(m)));
}

function clampDay(d: number): number {
  if (!Number.isFinite(d)) return 1;
  return Math.max(1, Math.floor(d));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatGameClock(hour = gameHour, minute = gameMinute): string {
  return `${pad2(clampHour(hour))}:${pad2(clampMinute(minute))}`;
}

export function resetShiftState(): void {
  currentDay = 1;
  gameHour = PRE_OPEN_HOUR;
  gameMinute = PRE_OPEN_MINUTE;
  shiftState = 'closed';
  clockAccumSec = 0;
}

/** Bootstrap or after load: set day/time/state without transition checks. */
export function initShift(opts?: {
  currentDay?: number;
  gameHour?: number;
  gameMinute?: number;
  shiftState?: ShiftState;
}): void {
  currentDay = clampDay(opts?.currentDay ?? 1);
  gameHour = clampHour(opts?.gameHour ?? PRE_OPEN_HOUR);
  gameMinute = clampMinute(opts?.gameMinute ?? PRE_OPEN_MINUTE);
  const s = opts?.shiftState;
  shiftState =
    s === 'closed' || s === 'open' || s === 'closing' || s === 'summary' ? s : 'closed';
  clockAccumSec = 0;
}

export function getShiftSnapshot(): ShiftSnapshot {
  return {
    currentDay,
    gameHour,
    gameMinute,
    shiftState,
  };
}

/** Keep day aligned with NightCycle nightNumber (same counter). */
export function syncShiftDay(nightNumber: number): void {
  currentDay = clampDay(nightNumber);
}

export function getShiftState(): ShiftState {
  return shiftState;
}

export function setGameTime(hour: number, minute: number): void {
  gameHour = clampHour(hour);
  gameMinute = clampMinute(minute);
  clockAccumSec = 0;
}

/**
 * Map shift → existing NightPhase used by ClubScene / UIScene.
 * closing still reports as 'open' so patrons/AI keep working until B7.
 */
export function legacyPhaseFromShift(state: ShiftState = shiftState): LegacyNightPhase {
  if (state === 'open' || state === 'closing') return 'open';
  if (state === 'summary') return 'summary';
  return 'prep';
}

function transition(to: ShiftState): boolean {
  const from = shiftState;
  if (from === to) return true;
  if (!ALLOWED[from].includes(to)) {
    console.warn(`[Shift] invalid transition ${from} → ${to}`);
    return false;
  }
  shiftState = to;
  return true;
}

/**
 * Abrir noche: closed|summary → open.
 * B2: snaps game clock to recommended open (18:00) and starts ticking.
 * Spawn + 75s real timer remain owned by ClubScene until later phases.
 */
export function beginShiftOpen(): boolean {
  if (shiftState === 'open') return true;
  if (shiftState === 'closing') {
    console.warn('[Shift] cannot open while closing');
    return false;
  }
  const ok =
    shiftState === 'summary' || shiftState === 'closed' ? transition('open') : false;
  if (!ok) return false;
  // B2 policy: early/default open always starts the clock at recommended open.
  setGameTime(RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE);
  return true;
}

/** Manual/auto close path until B7: open|closing → summary. Clock freezes. */
export function beginShiftSummary(): boolean {
  if (shiftState === 'summary') return true;
  if (shiftState === 'closed') {
    console.warn('[Shift] cannot summarize while closed');
    return false;
  }
  clockAccumSec = 0;
  if (shiftState === 'open') {
    shiftState = 'summary';
    return true;
  }
  return transition('summary');
}

/** Reserved for B7 soft-close (stop new arrivals, keep patrons). Clock keeps ticking. */
export function beginShiftClosing(): boolean {
  if (shiftState === 'closing') return true;
  return transition('closing');
}

/** Reserved for B10 Sleep → next day closed @ pre-open. */
export function beginShiftClosed(nextDay?: number): boolean {
  if (typeof nextDay === 'number') currentDay = clampDay(nextDay);
  shiftState = 'closed';
  setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
  return true;
}

/**
 * Advance game time while OPEN or CLOSING.
 * @returns number of whole game-minutes that advanced (0 if none / not ticking).
 */
export function tickShiftClock(dtSec: number): number {
  if (shiftState !== 'open' && shiftState !== 'closing') return 0;
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  const pace = REAL_SECONDS_PER_GAME_MINUTE;
  if (!(pace > 0)) return 0;

  clockAccumSec += dtSec;
  let advanced = 0;
  while (clockAccumSec >= pace) {
    clockAccumSec -= pace;
    gameMinute += 1;
    if (gameMinute >= 60) {
      gameMinute = 0;
      gameHour = (gameHour + 1) % 24;
    }
    advanced += 1;
  }
  return advanced;
}

export function isShiftClockTicking(): boolean {
  return shiftState === 'open' || shiftState === 'closing';
}

/**
 * Test helper: advance N whole game minutes while OPEN/CLOSING.
 * Returns minutes actually advanced.
 */
export function debugAdvanceGameMinutes(n: number): number {
  const steps = Math.max(0, Math.floor(n) || 0);
  let advanced = 0;
  const pace = REAL_SECONDS_PER_GAME_MINUTE;
  for (let i = 0; i < steps; i++) {
    const got = tickShiftClock(pace);
    if (got <= 0) break;
    advanced += got;
  }
  return advanced;
}

export function serializeShift(): ShiftPersist {
  return {
    currentDay,
    gameHour,
    gameMinute,
    shiftState,
  };
}

export function loadShift(raw: ShiftPersist | null | undefined, fallbackDay: number): void {
  const day = clampDay(
    typeof raw?.currentDay === 'number' ? raw.currentDay : fallbackDay
  );
  const hour =
    typeof raw?.gameHour === 'number' ? clampHour(raw.gameHour) : PRE_OPEN_HOUR;
  const minute =
    typeof raw?.gameMinute === 'number' ? clampMinute(raw.gameMinute) : PRE_OPEN_MINUTE;
  let state: ShiftState = 'closed';
  if (
    raw?.shiftState === 'closed' ||
    raw?.shiftState === 'open' ||
    raw?.shiftState === 'closing' ||
    raw?.shiftState === 'summary'
  ) {
    state =
      raw.shiftState === 'open' || raw.shiftState === 'closing' ? 'closed' : raw.shiftState;
  }
  if (state === 'summary') state = 'closed';
  initShift({ currentDay: day, gameHour: hour, gameMinute: minute, shiftState: state });
  if (state === 'closed' && (raw?.shiftState === 'open' || raw?.shiftState === 'closing')) {
    setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
  } else if (state === 'closed') {
    // Day start always presents pre-open time when closed.
    setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
  }
}

export function getShiftDebug() {
  const snap = getShiftSnapshot();
  return {
    ...snap,
    hhmm: formatGameClock(snap.gameHour, snap.gameMinute),
    legacyPhase: legacyPhaseFromShift(snap.shiftState),
    recommended: {
      open: formatGameClock(RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE),
      close: formatGameClock(RECOMMENDED_CLOSE_HOUR, RECOMMENDED_CLOSE_MINUTE),
      label: SCHEDULE_LABEL,
      labelMobile: SCHEDULE_LABEL_MOBILE,
      rangeShort: SCHEDULE_RANGE_SHORT,
    },
    preOpen: formatGameClock(PRE_OPEN_HOUR, PRE_OPEN_MINUTE),
    realSecondsPerGameMinute: REAL_SECONDS_PER_GAME_MINUTE,
    clockSpeedGameMinutesPerRealSecond: CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND,
    clockTicking: isShiftClockTicking(),
  };
}
