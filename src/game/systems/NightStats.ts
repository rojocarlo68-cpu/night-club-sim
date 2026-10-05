/**
 * Prompt A Phase 10: per-night sales / leave / sat roll-up.
 * Snapshots Inventory + Tips at night end (before openNight resets).
 */

import { NIGHT_STATS_HISTORY_CAP } from '../config/nightStats';
import {
  listInventory,
  getStockoutFirstMs,
  clearStockoutFirstMs,
} from './Inventory';
import { getTips } from './Tips';

export type LeaveReason = 'price' | 'oos_skip' | 'empty';

export interface NightDrinkLine {
  id: string;
  name: string;
  sold: number;
  revenue: number;
  stockout: boolean;
  /** First ms stock hit 0 this night (if known). */
  stockoutAtMs?: number;
}

export interface NightTipsLine {
  id: string;
  name: string;
  tips: number;
}

export interface NightLeftWithoutBuy {
  price: number;
  oos_skip: number;
  empty: number;
  total: number;
}

export interface NightStatsEntry {
  nightNumber: number;
  drinks: NightDrinkLine[];
  drinksSoldTotal: number;
  drinksRevenueTotal: number;
  stockedOutIds: string[];
  stockedOutNames: string[];
  tipsByStaff: NightTipsLine[];
  tipsTotal: number;
  servedCount: number;
  leftWithoutBuy: NightLeftWithoutBuy;
  /** Internal — never shown in player summary. */
  avgSatisfaction: number | null;
  visitCount: number;
  atMs: number;
  /** Prompt B Phase B9 — shift clock summary (player-visible). */
  openHhmm?: string | null;
  closeHhmm?: string | null;
  durationGameMinutes?: number | null;
  durationLabel?: string | null;
  staffWorked?: { id: string; name: string; durationGameMinutes: number; durationLabel: string }[];
}

/** In-night accumulators (reset on open / after snapshot). */
let leaveCounts: NightLeftWithoutBuy = { price: 0, oos_skip: 0, empty: 0, total: 0 };
let satSum = 0;
let satCount = 0;
const history: NightStatsEntry[] = [];
let lastSnapshot: NightStatsEntry | null = null;

export function resetNightAccumulators(): void {
  leaveCounts = { price: 0, oos_skip: 0, empty: 0, total: 0 };
  satSum = 0;
  satCount = 0;
  clearStockoutFirstMs();
}

export function noteLeaveWithoutBuy(reason: LeaveReason): void {
  if (reason === 'price') leaveCounts.price++;
  else if (reason === 'oos_skip') leaveCounts.oos_skip++;
  else leaveCounts.empty++;
  leaveCounts.total++;
}

/** Called from visit-finished hook / finalize path for this night's avg sat. */
export function noteNightVisitSatisfaction(sat: number): void {
  if (!Number.isFinite(sat)) return;
  satSum += sat;
  satCount++;
}

export function snapshotNightStats(opts: {
  nightNumber: number;
  servedCount: number;
  staff: { id: string; name: string }[];
  openHhmm?: string | null;
  closeHhmm?: string | null;
  durationGameMinutes?: number | null;
  durationLabel?: string | null;
  staffWorked?: NightStatsEntry['staffWorked'];
}): NightStatsEntry {
  const inv = listInventory();
  const stockouts = getStockoutFirstMs();
  const drinks: NightDrinkLine[] = inv.map((l) => {
    const soMs = stockouts[l.id];
    const hitThisNight = typeof soMs === 'number';
    return {
      id: l.id,
      name: l.name,
      sold: l.soldTonight,
      revenue: l.revenueTonight,
      stockout: hitThisNight,
      stockoutAtMs: hitThisNight ? soMs : undefined,
    };
  });
  // Only products that actually hit 0 during THIS night (sale or setStock).
  const stockedOutIds: string[] = [];
  const stockedOutNames: string[] = [];
  for (const d of drinks) {
    if (d.stockout) {
      stockedOutIds.push(d.id);
      stockedOutNames.push(d.name);
    }
  }

  const tipsByStaff: NightTipsLine[] = opts.staff.map((s) => ({
    id: s.id,
    name: s.name,
    tips: getTips(s.id).tipsNight,
  }));
  const tipsTotal = tipsByStaff.reduce((a, t) => a + t.tips, 0);
  const drinksSoldTotal = drinks.reduce((a, d) => a + d.sold, 0);
  const drinksRevenueTotal = drinks.reduce((a, d) => a + d.revenue, 0);
  const avgSatisfaction =
    satCount > 0 ? Math.round((satSum / satCount) * 10) / 10 : null;

  const entry: NightStatsEntry = {
    nightNumber: opts.nightNumber,
    drinks,
    drinksSoldTotal,
    drinksRevenueTotal,
    stockedOutIds,
    stockedOutNames,
    tipsByStaff,
    tipsTotal,
    servedCount: opts.servedCount,
    leftWithoutBuy: { ...leaveCounts },
    avgSatisfaction,
    visitCount: satCount,
    atMs: Date.now(),
    openHhmm: opts.openHhmm ?? null,
    closeHhmm: opts.closeHhmm ?? null,
    durationGameMinutes: opts.durationGameMinutes ?? null,
    durationLabel: opts.durationLabel ?? null,
    staffWorked: opts.staffWorked ? opts.staffWorked.map((s) => ({ ...s })) : [],
  };
  history.push(entry);
  while (history.length > NIGHT_STATS_HISTORY_CAP) history.shift();
  lastSnapshot = entry;
  return entry;
}

export function getLastNightStats(): NightStatsEntry | null {
  return lastSnapshot ? { ...lastSnapshot, drinks: lastSnapshot.drinks.map((d) => ({ ...d })), tipsByStaff: lastSnapshot.tipsByStaff.map((t) => ({ ...t })), leftWithoutBuy: { ...lastSnapshot.leftWithoutBuy } } : null;
}

export function getNightStatsHistory(): NightStatsEntry[] {
  return history.map((e) => ({
    ...e,
    drinks: e.drinks.map((d) => ({ ...d })),
    tipsByStaff: e.tipsByStaff.map((t) => ({ ...t })),
    leftWithoutBuy: { ...e.leftWithoutBuy },
    stockedOutIds: [...e.stockedOutIds],
    stockedOutNames: [...e.stockedOutNames],
  }));
}

export function serializeNightStatsHistory(): NightStatsEntry[] {
  return getNightStatsHistory();
}

export function loadNightStatsHistory(raw: unknown): void {
  history.length = 0;
  lastSnapshot = null;
  if (!Array.isArray(raw)) return;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<NightStatsEntry>;
    if (typeof r.nightNumber !== 'number') continue;
    const entry: NightStatsEntry = {
      nightNumber: r.nightNumber,
      drinks: Array.isArray(r.drinks) ? (r.drinks as NightDrinkLine[]) : [],
      drinksSoldTotal: typeof r.drinksSoldTotal === 'number' ? r.drinksSoldTotal : 0,
      drinksRevenueTotal: typeof r.drinksRevenueTotal === 'number' ? r.drinksRevenueTotal : 0,
      stockedOutIds: Array.isArray(r.stockedOutIds) ? (r.stockedOutIds as string[]) : [],
      stockedOutNames: Array.isArray(r.stockedOutNames) ? (r.stockedOutNames as string[]) : [],
      tipsByStaff: Array.isArray(r.tipsByStaff) ? (r.tipsByStaff as NightTipsLine[]) : [],
      tipsTotal: typeof r.tipsTotal === 'number' ? r.tipsTotal : 0,
      servedCount: typeof r.servedCount === 'number' ? r.servedCount : 0,
      leftWithoutBuy: {
        price: (r.leftWithoutBuy as NightLeftWithoutBuy)?.price ?? 0,
        oos_skip: (r.leftWithoutBuy as NightLeftWithoutBuy)?.oos_skip ?? 0,
        empty: (r.leftWithoutBuy as NightLeftWithoutBuy)?.empty ?? 0,
        total: (r.leftWithoutBuy as NightLeftWithoutBuy)?.total ?? 0,
      },
      avgSatisfaction:
        typeof r.avgSatisfaction === 'number' ? r.avgSatisfaction : null,
      visitCount: typeof r.visitCount === 'number' ? r.visitCount : 0,
      atMs: typeof r.atMs === 'number' ? r.atMs : 0,
    };
    history.push(entry);
  }
  while (history.length > NIGHT_STATS_HISTORY_CAP) history.shift();
  lastSnapshot = history.length ? history[history.length - 1] : null;
}

export function getNightStatsDebug() {
  return {
    last: getLastNightStats(),
    history: getNightStatsHistory(),
    live: {
      leaveCounts: { ...leaveCounts },
      satSum,
      satCount,
      stockouts: getStockoutFirstMs(),
    },
  };
}
