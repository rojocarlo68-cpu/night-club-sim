/**
 * Prompt B Phase B11 — late-open experience stub.
 * Full “phantom waiters while closed” system is SKIPPED.
 * Only a small one-shot sat penalty on the first N patrons when open was late.
 */

import {
  LATE_OPEN_GRACE_GAME_MINUTES,
  LATE_OPEN_SAT_FIRST_N_PATRONS,
  LATE_OPEN_SAT_PENALTY,
} from '../config/demand';
import { RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE } from '../config/shift';
import { applyExperience } from './CustomerExperience';
import { getShiftOpenCloseTimes } from './Shift';

let lateOpenActive = false;
let lateOpenAppliedCount = 0;

function absMin(hour: number, minute: number): number {
  return (
    (((Math.floor(hour) % 24) + 24) % 24) * 60 + Math.max(0, Math.min(59, Math.floor(minute)))
  );
}

/** Call from beginArrivalsNight / openNight after open time is known. */
export function beginLateOpenNight(openHour: number, openMinute: number): void {
  lateOpenAppliedCount = 0;
  const openAbs = absMin(openHour, openMinute);
  const recAbs = absMin(RECOMMENDED_OPEN_HOUR, RECOMMENDED_OPEN_MINUTE);
  const graceEnd = recAbs + LATE_OPEN_GRACE_GAME_MINUTES;
  lateOpenActive = openAbs > graceEnd;
}

export function resetLateOpenNight(): void {
  lateOpenActive = false;
  lateOpenAppliedCount = 0;
}

/**
 * If this night opened late past grace, apply a small one-shot sat penalty
 * to the first LATE_OPEN_SAT_FIRST_N_PATRONS patrons only.
 * Does NOT model phantom wait time; conservative stub only.
 */
export function applyLateOpenExperience(patron: {
  profile: { name?: string; id?: string };
}): number {
  if (!lateOpenActive) return 0;
  if (lateOpenAppliedCount >= LATE_OPEN_SAT_FIRST_N_PATRONS) return 0;
  lateOpenAppliedCount += 1;
  return applyExperience(patron, 'late_open_wait', LATE_OPEN_SAT_PENALTY);
}

export function getLateOpenDebug() {
  const oc = getShiftOpenCloseTimes();
  return {
    lateOpenActive,
    lateOpenAppliedCount,
    firstN: LATE_OPEN_SAT_FIRST_N_PATRONS,
    satPenalty: LATE_OPEN_SAT_PENALTY,
    graceGameMinutes: LATE_OPEN_GRACE_GAME_MINUTES,
    openTime: oc.openTime,
    phantomWaitersImplemented: false,
  };
}
