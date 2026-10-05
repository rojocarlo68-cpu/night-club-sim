/**
 * Phase 9: pay monthly gas/water/electricity when NightCycle fires onMonthlyDue.
 * Tips are never touched — only club money via host.deductClubMoney.
 */

import { monthlyUtilityLines, monthlyUtilitiesTotal } from '../config/utilities';
import { onMonthlyDue, NightCycleHost } from './NightCycle';

export interface UtilityLine {
  label: string;
  amount: number;
}

export interface UtilityRecord {
  night: number;
  lines: UtilityLine[];
  total: number;
}

/** Host methods ClubScene provides when passed to onNightEnd. */
export interface UtilitiesHost extends NightCycleHost {
  /** Subtract from club money (may go negative). */
  deductClubMoney(amount: number): void;
}

const HISTORY_CAP = 12;

let history: UtilityRecord[] = [];
/** Set on pay night; consumed once by night-summary. */
let lastPaid: UtilityRecord | null = null;

function isUtilitiesHost(host: NightCycleHost): host is UtilitiesHost {
  const h = host as UtilitiesHost;
  return typeof h.deductClubMoney === 'function';
}

function runUtilities(night: number, host: UtilitiesHost): UtilityRecord {
  const lines: UtilityLine[] = monthlyUtilityLines()
    .filter((l) => l.amount > 0)
    .map((l) => ({ label: l.label, amount: l.amount }));
  const total =
    lines.length > 0
      ? lines.reduce((sum, l) => sum + l.amount, 0)
      : monthlyUtilitiesTotal();
  if (total > 0) {
    host.deductClubMoney(total);
  }
  const record: UtilityRecord = { night, lines, total };
  lastPaid = record;
  history.push(record);
  if (history.length > HISTORY_CAP) {
    history = history.slice(-HISTORY_CAP);
  }
  console.log(`[Utilities] monthly night ${night} total -$${total}`, lines);
  return record;
}

/** Subscribe once at module load (Phase 7 monthly hook). */
onMonthlyDue((night, host) => {
  if (!isUtilitiesHost(host)) {
    console.warn('[Utilities] host missing deductClubMoney — skipped');
    return;
  }
  runUtilities(night, host);
});

/** Take the utilities bill from this night end (clears so non-pay nights stay clean). */
export function takeLastUtilities(): UtilityRecord | null {
  const r = lastPaid;
  lastPaid = null;
  return r;
}

export function peekLastUtilities(): UtilityRecord | null {
  return lastPaid;
}

export function getUtilitiesHistory(): UtilityRecord[] {
  return history.map((r) => ({
    night: r.night,
    total: r.total,
    lines: r.lines.map((l) => ({ ...l })),
  }));
}

export function serializeUtilitiesHistory(): UtilityRecord[] {
  return getUtilitiesHistory();
}

export function loadUtilitiesHistory(raw: unknown): void {
  history = [];
  lastPaid = null;
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const night = typeof o.night === 'number' && Number.isFinite(o.night) ? Math.floor(o.night) : 0;
    if (night <= 0) continue;
    const linesRaw = Array.isArray(o.lines) ? o.lines : [];
    const lines: UtilityLine[] = [];
    for (const lr of linesRaw) {
      if (!lr || typeof lr !== 'object') continue;
      const L = lr as Record<string, unknown>;
      const label = typeof L.label === 'string' ? L.label : '';
      const amount =
        typeof L.amount === 'number' && Number.isFinite(L.amount)
          ? Math.max(0, Math.floor(L.amount))
          : 0;
      if (!label || amount <= 0) continue;
      lines.push({ label, amount });
    }
    const total =
      typeof o.total === 'number' && Number.isFinite(o.total)
        ? Math.max(0, Math.floor(o.total))
        : lines.reduce((s, l) => s + l.amount, 0);
    history.push({ night, lines, total });
  }
  if (history.length > HISTORY_CAP) {
    history = history.slice(-HISTORY_CAP);
  }
}

/** Test helper. */
export function resetUtilitiesState(): void {
  history = [];
  lastPaid = null;
}
