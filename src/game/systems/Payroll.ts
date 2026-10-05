/**
 * Phase 8: pay weekly salaries when NightCycle fires onWeeklyDue.
 * Tips are never touched — only club money via host.deductClubMoney.
 */

import { weeklySalaryFor } from '../config/salaries';
import { onWeeklyDue, NightCycleHost } from './NightCycle';

export interface PayrollLine {
  id: string;
  name: string;
  amount: number;
}

export interface PayrollRecord {
  night: number;
  lines: PayrollLine[];
  total: number;
}

/** Host methods ClubScene provides when passed to onNightEnd. */
export interface PayrollHost extends NightCycleHost {
  listPayrollStaff(): { id: string; name: string }[];
  /** Subtract from club money (may go negative). */
  deductClubMoney(amount: number): void;
}

const HISTORY_CAP = 12;

let history: PayrollRecord[] = [];
/** Set on pay night; consumed once by night-summary. */
let lastPaid: PayrollRecord | null = null;

function isPayrollHost(host: NightCycleHost): host is PayrollHost {
  const h = host as PayrollHost;
  return typeof h.listPayrollStaff === 'function' && typeof h.deductClubMoney === 'function';
}

function runPayroll(night: number, host: PayrollHost): PayrollRecord {
  const staff = host.listPayrollStaff() ?? [];
  const lines: PayrollLine[] = [];
  for (const s of staff) {
    if (!s?.id) continue;
    const amount = weeklySalaryFor(s.id);
    if (amount <= 0) continue;
    lines.push({
      id: s.id,
      name: s.name || s.id,
      amount,
    });
  }
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total > 0) {
    host.deductClubMoney(total);
  }
  const record: PayrollRecord = { night, lines, total };
  lastPaid = record;
  history.push(record);
  if (history.length > HISTORY_CAP) {
    history = history.slice(-HISTORY_CAP);
  }
  console.log(`[Payroll] weekly night ${night} total -$${total}`, lines);
  return record;
}

/** Subscribe once at module load (Phase 7 weekly hook). */
onWeeklyDue((night, host) => {
  if (!isPayrollHost(host)) {
    console.warn('[Payroll] host missing listPayrollStaff/deductClubMoney — skipped');
    return;
  }
  runPayroll(night, host);
});

/** Take the payroll from this night end (clears so non-pay nights stay clean). */
export function takeLastPayroll(): PayrollRecord | null {
  const r = lastPaid;
  lastPaid = null;
  return r;
}

export function peekLastPayroll(): PayrollRecord | null {
  return lastPaid;
}

export function getPayrollHistory(): PayrollRecord[] {
  return history.map((r) => ({
    night: r.night,
    total: r.total,
    lines: r.lines.map((l) => ({ ...l })),
  }));
}

export function serializePayrollHistory(): PayrollRecord[] {
  return getPayrollHistory();
}

export function loadPayrollHistory(raw: unknown): void {
  history = [];
  lastPaid = null;
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const night = typeof o.night === 'number' && Number.isFinite(o.night) ? Math.floor(o.night) : 0;
    if (night <= 0) continue;
    const linesRaw = Array.isArray(o.lines) ? o.lines : [];
    const lines: PayrollLine[] = [];
    for (const lr of linesRaw) {
      if (!lr || typeof lr !== 'object') continue;
      const L = lr as Record<string, unknown>;
      const id = typeof L.id === 'string' ? L.id : '';
      const name = typeof L.name === 'string' ? L.name : id;
      const amount =
        typeof L.amount === 'number' && Number.isFinite(L.amount)
          ? Math.max(0, Math.floor(L.amount))
          : 0;
      if (!id || amount <= 0) continue;
      lines.push({ id, name, amount });
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
export function resetPayrollState(): void {
  history = [];
  lastPaid = null;
}
