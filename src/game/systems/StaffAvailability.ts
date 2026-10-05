/**
 * Prompt B Phase B11 — who can work tonight.
 * Map defaults to available=true. Rare absence event is NOT implemented.
 */

import { STAFF_AVAILABLE_BY_DEFAULT } from '../config/staffAvailability';

/** staffId → available for the current / next open. Missing key = default. */
const availability = new Map<string, boolean>();

export function resetStaffAvailability(): void {
  availability.clear();
}

export function setStaffAvailable(staffId: string, available: boolean): void {
  if (!staffId) return;
  availability.set(staffId, !!available);
}

export function isStaffAvailable(staffId: string): boolean {
  if (!staffId) return false;
  if (!availability.has(staffId)) return STAFF_AVAILABLE_BY_DEFAULT;
  return availability.get(staffId) === true;
}

/**
 * Filter roster to staff who can work.
 * TODO B11+: rare absence event may mark someone false for one night.
 */
export function getAvailableStaff<T extends { id: string }>(roster: T[]): T[] {
  return roster.filter((s) => isStaffAvailable(s.id));
}

export function getStaffAvailabilityDebug() {
  const entries: Record<string, boolean> = {};
  for (const [id, v] of availability) entries[id] = v;
  return {
    defaultAvailable: STAFF_AVAILABLE_BY_DEFAULT,
    overrides: entries,
    /** Documented: rare absence event not implemented. */
    absenceEventImplemented: false,
  };
}
