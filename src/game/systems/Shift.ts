/**
 * Prompt B Phase B1 — single source of truth for day / game clock / shift state.
 * Does not tick the clock, spawn patrons, or soft-close yet (B2+).
 *
 * Maps to existing NightPhase for UI/AI compatibility:
 *   closed  ↔ prep
 *   open    ↔ open
 *   closing ↔ (reserved; B7 — still treated as open for patrons until wired)
 *   summary ↔ summary
 */

import {
  PRE_OPEN_HOUR,
  PRE_OPEN_MINUTE,
  RECOMMENDED_CLOSE_HOUR,
  RECOMMENDED_CLOSE_MINUTE,
  RECOMMENDED_OPEN_HOUR,
  RECOMMENDED_OPEN_MINUTE,
  CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND,
  SCHEDULE_LABEL,
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
  // summary allowed until B7 introduces a real CLOSING dwell
  open: ['closing', 'summary'],
  closing: ['summary'],
  // Abrir noche from summary goes straight to open; Sleep (B10) will use closed
  summary: ['open', 'closed'],
};

let currentDay = 1;
let gameHour = PRE_OPEN_HOUR;
let gameMinute = PRE_OPEN_MINUTE;
let shiftState: ShiftState = 'closed';

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

export function resetShiftState(): void {
  currentDay = 1;
  gameHour = PRE_OPEN_HOUR;
  gameMinute = PRE_OPEN_MINUTE;
  shiftState = 'closed';
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
 * Does not change spawn or real-second timer (caller still owns those in B1).
 */
export function beginShiftOpen(): boolean {
  if (shiftState === 'open') return true;
  if (shiftState === 'closing') {
    console.warn('[Shift] cannot open while closing');
    return false;
  }
  // From summary, go open directly (existing Abrir-from-summary flow).
  if (shiftState === 'summary') {
    return transition('open');
  }
  return transition('open');
}

/** Manual/auto close path until B7: open|closing → summary. */
export function beginShiftSummary(): boolean {
  if (shiftState === 'summary') return true;
  if (shiftState === 'closed') {
    console.warn('[Shift] cannot summarize while closed');
    return false;
  }
  if (shiftState === 'open') {
    // Skip dwelling in closing for B1 (instant finishNight).
    shiftState = 'summary';
    return true;
  }
  return transition('summary');
}

/** Reserved for B7 soft-close (stop new arrivals, keep patrons). */
export function beginShiftClosing(): boolean {
  if (shiftState === 'closing') return true;
  return transition('closing');
}

/** Reserved for B10 Sleep → next day closed @ pre-open. */
export function beginShiftClosed(nextDay?: number): boolean {
  if (typeof nextDay === 'number') currentDay = clampDay(nextDay);
  if (shiftState === 'closed') {
    setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
    return true;
  }
  if (shiftState !== 'summary' && shiftState !== 'closing') {
    // Allow force-reset from open only via explicit summary first in normal flow.
    if (shiftState === 'open') {
      console.warn('[Shift] close-from-open should go via summary; forcing closed');
    }
  }
  shiftState = 'closed';
  setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
  return true;
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
    // Never restore mid-open/closing from save — day starts closed (player must Abrir).
    state =
      raw.shiftState === 'open' || raw.shiftState === 'closing' ? 'closed' : raw.shiftState;
  }
  // Summary at load → treat as closed ready for Abrir (same as fresh prep).
  if (state === 'summary') state = 'closed';
  initShift({ currentDay: day, gameHour: hour, gameMinute: minute, shiftState: state });
  // Prefer pre-open time when forced closed from a mid-shift save.
  if (state === 'closed' && (raw?.shiftState === 'open' || raw?.shiftState === 'closing')) {
    setGameTime(PRE_OPEN_HOUR, PRE_OPEN_MINUTE);
  }
}

export function getShiftDebug() {
  const snap = getShiftSnapshot();
  return {
    ...snap,
    legacyPhase: legacyPhaseFromShift(snap.shiftState),
    recommended: {
      open: `${String(RECOMMENDED_OPEN_HOUR).padStart(2, '0')}:${String(RECOMMENDED_OPEN_MINUTE).padStart(2, '0')}`,
      close: `${String(RECOMMENDED_CLOSE_HOUR).padStart(2, '0')}:${String(RECOMMENDED_CLOSE_MINUTE).padStart(2, '0')}`,
      label: SCHEDULE_LABEL,
      rangeShort: SCHEDULE_RANGE_SHORT,
    },
    preOpen: `${String(PRE_OPEN_HOUR).padStart(2, '0')}:${String(PRE_OPEN_MINUTE).padStart(2, '0')}`,
    clockSpeedGameMinutesPerRealSecond: CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND,
    clockTicking: false, // B2
  };
}
