/**
 * Bankruptcy tracker (single source; reads club money — no parallel ledger).
 * Evaluated once per night end, AFTER the existing weekly/monthly charges ran (NightCycle).
 *   money ≥ 0              → no debt (any previous debt is cleared)
 *   money < 0, first time  → debt opened: deadline = endedNight + graceNights
 *   money < 0, past grace  → BANCARROTA (game over)
 * One bad night can never end the game: a debt always gets the full grace period first.
 */
import { BANKRUPTCY } from '../config/bankruptcy';

export interface BankruptcyState {
  /** Night whose end first left the club in the red (null = no debt). */
  debtSinceNight: number | null;
  /** Last night (end) by which money must be back to ≥ 0. */
  deadlineNight: number | null;
  bankrupt: boolean;
  /** Worst balance seen during the current debt (positive amount). */
  worstDebt: number;
}

let st: BankruptcyState = { debtSinceNight: null, deadlineNight: null, bankrupt: false, worstDebt: 0 };

export interface BankruptcyEval {
  inDebt: boolean;
  debt: number;
  daysLeft: number | null;
  bankrupt: boolean;
  justOpened: boolean;
}

export function evaluateBankruptcyAtNightEnd(endedNight: number, money: number): BankruptcyEval {
  const n = Math.max(1, Math.floor(endedNight) || 1);
  if (st.bankrupt) return { inDebt: true, debt: Math.max(0, -Math.floor(money)), daysLeft: 0, bankrupt: true, justOpened: false };
  if (!(money < 0)) {
    st.debtSinceNight = null;
    st.deadlineNight = null;
    st.worstDebt = 0;
    return { inDebt: false, debt: 0, daysLeft: null, bankrupt: false, justOpened: false };
  }
  const debt = Math.ceil(-money);
  let justOpened = false;
  if (st.debtSinceNight == null) {
    st.debtSinceNight = n;
    st.deadlineNight = n + BANKRUPTCY.graceNights;
    st.worstDebt = debt;
    justOpened = true;
  } else {
    st.worstDebt = Math.max(st.worstDebt, debt);
  }
  const daysLeft = Math.max(0, (st.deadlineNight ?? n) - n);
  if (!justOpened && n >= (st.deadlineNight ?? n)) {
    st.bankrupt = true;
    return { inDebt: true, debt, daysLeft: 0, bankrupt: true, justOpened };
  }
  return { inDebt: true, debt, daysLeft, bankrupt: false, justOpened };
}

export function isBankrupt(): boolean {
  return st.bankrupt;
}

export function getBankruptcyState(): BankruptcyState {
  return { ...st };
}

export function serializeBankruptcy(): BankruptcyState {
  return { ...st };
}

export function loadBankruptcy(raw: unknown): void {
  st = { debtSinceNight: null, deadlineNight: null, bankrupt: false, worstDebt: 0 };
  if (!raw || typeof raw !== 'object') return;
  const o = raw as Partial<BankruptcyState>;
  if (typeof o.debtSinceNight === 'number') st.debtSinceNight = Math.floor(o.debtSinceNight);
  if (typeof o.deadlineNight === 'number') st.deadlineNight = Math.floor(o.deadlineNight);
  if (typeof o.worstDebt === 'number') st.worstDebt = Math.max(0, o.worstDebt);
  st.bankrupt = !!o.bankrupt;
}

export function resetBankruptcy(): void {
  st = { debtSinceNight: null, deadlineNight: null, bankrupt: false, worstDebt: 0 };
}
