/**
 * Prompt B Phase B8 — per-staff hours worked this shift.
 * Records start on open, end on close. Fatigue fields are placeholders only.
 */

import {
  OVERTIME_AFTER_HOUR,
  OVERTIME_AFTER_MINUTE,
  FATIGUE_PER_OVERTIME_HOUR,
  FATIGUE_PENDING_CAP,
} from '../config/staffHours';
import { formatGameClock } from './Shift';

export interface StaffShiftLog {
  staffId: string;
  name: string;
  startAbsMin: number;
  endAbsMin: number | null;
  durationWorkedGameMinutes: number;
  overtimeGameMinutes: number;
  /** Placeholder — not applied to energy/mood. */
  pendingFatigue: number;
  startHhmm: string;
  endHhmm: string | null;
}

let logs: StaffShiftLog[] = [];
let lastClosedLogs: StaffShiftLog[] = [];

function absMin(hour: number, minute: number): number {
  return (
    (((Math.floor(hour) % 24) + 24) % 24) * 60 + Math.max(0, Math.min(59, Math.floor(minute)))
  );
}

function continuousEnd(startAbs: number, endHour: number, endMinute: number): number {
  let end = absMin(endHour, endMinute);
  if (end < startAbs) end += 24 * 60;
  return end;
}

function overtimeMinutes(startAbs: number, endAbs: number): number {
  const otThreshold = absMin(OVERTIME_AFTER_HOUR, OVERTIME_AFTER_MINUTE);
  // Overtime window is after recommended close on the same continuous timeline.
  // If shift started evening (e.g. 18:00=1080) and closed 02:30 next day (150 continuous = 1080+...):
  // endAbs is continuous; ot line is startAbs's day close = startAbs's date + (2:00).
  // Simpler: overtime = minutes of work that fall after 02:00 on the clock, counted from when
  // continuous time crosses the first 02:00 after open.
  let otLine = otThreshold;
  if (otLine <= startAbs) otLine += 24 * 60;
  if (endAbs <= otLine) return 0;
  return endAbs - otLine;
}

function fatigueFromOvertime(otMin: number): number {
  const hours = otMin / 60;
  return Math.min(FATIGUE_PENDING_CAP, Math.round(hours * FATIGUE_PER_OVERTIME_HOUR));
}

export function resetStaffHours(): void {
  logs = [];
}

/** Call on Abrir for each staff member working tonight. */
export function recordStaffShiftStart(
  staff: { id: string; name: string }[],
  hour: number,
  minute: number
): void {
  const start = absMin(hour, minute);
  logs = staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    startAbsMin: start,
    endAbsMin: null,
    durationWorkedGameMinutes: 0,
    overtimeGameMinutes: 0,
    pendingFatigue: 0,
    startHhmm: formatGameClock(hour, minute),
    endHhmm: null,
  }));
}

/** Call when entering CLOSING (preferred) or SUMMARY. */
export function recordStaffShiftEnd(hour: number, minute: number): void {
  for (const log of logs) {
    if (log.endAbsMin != null) continue;
    const end = continuousEnd(log.startAbsMin, hour, minute);
    log.endAbsMin = end;
    log.durationWorkedGameMinutes = Math.max(0, end - log.startAbsMin);
    log.overtimeGameMinutes = overtimeMinutes(log.startAbsMin, end);
    // Placeholder only — do NOT apply to energy/mood.
    log.pendingFatigue = fatigueFromOvertime(log.overtimeGameMinutes);
    log.endHhmm = formatGameClock(hour, minute);
  }
  lastClosedLogs = logs.map((l) => ({ ...l }));
}

export function formatDurationHm(totalMin: number): string {
  const m = Math.max(0, Math.floor(totalMin));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  return `${h}h ${mm}m`;
}

export function getLastStaffHours(): StaffShiftLog[] {
  return lastClosedLogs.map((l) => ({ ...l }));
}

export function getStaffHoursDebug() {
  return {
    active: logs.map((l) => ({ ...l })),
    lastClosed: lastClosedLogs.map((l) => ({ ...l })),
    overtimeAfter: formatGameClock(OVERTIME_AFTER_HOUR, OVERTIME_AFTER_MINUTE),
    fatiguePerOvertimeHour: FATIGUE_PER_OVERTIME_HOUR,
    fatigueAppliedToStats: false,
  };
}
