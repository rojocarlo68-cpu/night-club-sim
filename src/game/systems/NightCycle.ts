/**
 * Phase 7: night end roll-up + weekly/monthly hooks for Phases 8–9.
 * Called once from ClubScene.finishNight — does not change open/close behaviour.
 */

import { isMonthEnd, isWeekEnd } from '../config/calendar';

/** Minimal host so this module stays free of ClubScene imports. */
export interface NightCycleHost {
  nightNumber: number;
}

export type NightDueHook = (nightNumber: number, host: NightCycleHost) => void;

const weeklyHooks: NightDueHook[] = [];
const monthlyHooks: NightDueHook[] = [];

/** Subscribe for Phase 8 (salaries). */
export function onWeeklyDue(cb: NightDueHook): void {
  weeklyHooks.push(cb);
}

/** Subscribe for Phase 9 (utilities). */
export function onMonthlyDue(cb: NightDueHook): void {
  monthlyHooks.push(cb);
}

/** Nights already finalized (guards double finishNight / debugEndNight). */
const finalizedNights = new Set<number>();

/**
 * Run once when a night ends.
 * Tips: Phase 1 keeps jornada == night; resetNightTips() still runs on openNight
 * (clears tipsNight + tipsDay). tipsTotal already accumulates on recordTip — no
 * extra roll-up needed here. Summary UI can still read night tips until open.
 *
 * @returns the night number that just ended (before increment)
 */
export function onNightEnd(host: NightCycleHost): number {
  const n = Math.max(1, Math.floor(host.nightNumber) || 1);
  if (finalizedNights.has(n)) {
    return n;
  }
  finalizedNights.add(n);

  if (isWeekEnd(n)) {
    console.log(`[NightCycle] weeklyDue night ${n}`);
    for (const h of weeklyHooks) {
      try {
        h(n, host);
      } catch (err) {
        console.error('[NightCycle] weeklyDue hook error', err);
      }
    }
  }
  if (isMonthEnd(n)) {
    console.log(`[NightCycle] monthlyDue night ${n}`);
    for (const h of monthlyHooks) {
      try {
        h(n, host);
      } catch (err) {
        console.error('[NightCycle] monthlyDue hook error', err);
      }
    }
  }

  host.nightNumber = n + 1;
  return n;
}

/** Test helper: clear finalized set (e.g. after loading a save). */
export function resetNightCycleState(): void {
  finalizedNights.clear();
}
