/**
 * Per-staff tip ledger (Phase 1 of tips / economy).
 * Tips belong to the employee; the club only receives the drink price (tips go to the wallet).
 */

export interface StaffTips {
  /** Tips earned during the current night (resets when a night opens). */
  tipsNight: number;
  /**
   * Tips for the current work day / jornada.
   * Phase 7: jornada still aligns with the night cycle and resets with tipsNight
   * on openNight (resetNightTips). Night end does not clear these counters so the
   * summary can show them; tipsTotal already rolls up on recordTip.
   */
  tipsDay: number;
  /** Lifetime tips; never reset. */
  tipsTotal: number;
}

type TipsMap = Record<string, StaffTips>;

const empty = (): StaffTips => ({ tipsNight: 0, tipsDay: 0, tipsTotal: 0 });

let byStaff: TipsMap = {};

function ensure(staffId: string): StaffTips {
  if (!byStaff[staffId]) byStaff[staffId] = empty();
  return byStaff[staffId];
}

/** Record a tip for the staff member who served. Amount must be > 0. */
export function recordTip(staffId: string, amount: number): void {
  if (!staffId || !(amount > 0) || !Number.isFinite(amount)) return;
  const n = Math.max(0, Math.floor(amount));
  if (n <= 0) return;
  const t = ensure(staffId);
  t.tipsNight += n;
  t.tipsDay += n;
  t.tipsTotal += n;
}

export function getTips(staffId: string): StaffTips {
  const t = byStaff[staffId];
  return t ? { ...t } : empty();
}

/** Reset night + day counters for every staff (called when opening a night and on Dormir / new day). */
export function resetNightTips(): void {
  for (const id of Object.keys(byStaff)) {
    byStaff[id].tipsNight = 0;
    // tipsDay tracks the current jornada; Phase 7 keeps jornada == night (reset on open).
    byStaff[id].tipsDay = 0;
  }
}

/** Persistable snapshot (safe to omit in old saves → migrate as zeros). */
export function serializeTips(): TipsMap {
  const out: TipsMap = {};
  for (const id of Object.keys(byStaff)) {
    const t = byStaff[id];
    out[id] = {
      tipsNight: t.tipsNight | 0,
      tipsDay: t.tipsDay | 0,
      tipsTotal: t.tipsTotal | 0,
    };
  }
  return out;
}

/** Load from save; unknown / corrupt entries become zeros. */
export function loadTips(raw: unknown): void {
  byStaff = {};
  if (!raw || typeof raw !== 'object') return;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== 'string' || !id) continue;
    if (!v || typeof v !== 'object') {
      byStaff[id] = empty();
      continue;
    }
    const o = v as Record<string, unknown>;
    const num = (x: unknown) =>
      typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
    byStaff[id] = {
      tipsNight: num(o.tipsNight),
      tipsDay: num(o.tipsDay),
      tipsTotal: num(o.tipsTotal),
    };
  }
}
