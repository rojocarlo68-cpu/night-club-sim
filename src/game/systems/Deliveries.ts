/**
 * Restock ORDERS + physical goods (logic only; visuals / staff live in ClubScene).
 *
 * money (paid once at confirm) → pending order → wait (game minutes) → supplier drops packages
 * at the entrance → staff carry them → behind the bar → Inventory.addStock (the ONLY place the
 * stock number rises). The inventory itself is NOT duplicated: goods hold units until stored.
 */
import { PACKAGING, DELIVERY_TIMING } from '../config/logistics';
import { getSnackProduct } from '../config/snacks';
import { getDrinkProduct } from '../config/drinks';
import type { ShiftState } from './Shift';

export type PackageKind = 'crate' | 'bottle' | 'sack';

export interface OrderLine {
  productId: string;
  units: number;
}

export interface PendingOrder {
  id: string;
  lines: OrderLine[];
  cost: number;
  /** Day the order was placed. */
  placedDay: number;
  placedClock: string;
  /** Delivered on the next day (ordered after closing, or not delivered before closing). */
  nextDay: boolean;
  /** Absolute game minute when the supplier shows up (null while waiting for the next day). */
  dueAbs: number | null;
  status: 'in_transit' | 'arriving';
}

export interface GoodsItem {
  id: string;
  productId: string;
  kind: PackageKind;
  units: number;
  col: number;
  row: number;
  /** Visual slot on its tile (pile layout). */
  slot: number;
  orderId: string;
  /** Staff that reserved it for a trip. */
  claimedBy: string | null;
  /** Staff currently carrying it (off the floor). */
  carriedBy: string | null;
}

export interface DeliveriesSave {
  absMinute?: number;
  seq?: number;
  orders?: PendingOrder[];
  goods?: GoodsItem[];
}

let absMinute = 0;
let seq = 0;
let orders: PendingOrder[] = [];
let goods: GoodsItem[] = [];
/** Units stored behind the bar through deliveries (debug / tests). */
const storedLog: Array<{ productId: string; units: number; by: string; at: number }> = [];

export function isSnackProduct(id: string): boolean {
  return !!getSnackProduct(id);
}

/** Ordering step: drinks per unit, botanas per sack (100). */
export function orderUnitStep(productId: string): number {
  return isSnackProduct(productId) ? PACKAGING.snackSackUnits : 1;
}

/** Snacks are ordered by whole sacks (50 → 1 sack = 100 units). Drinks unchanged. */
export function normalizeOrderUnits(productId: string, units: number): number {
  const n = Math.max(0, Math.floor(units || 0));
  if (n <= 0) return 0;
  if (isSnackProduct(productId)) {
    const s = PACKAGING.snackSackUnits;
    return Math.ceil(n / s) * s;
  }
  return n;
}

/**
 * Universal packing. Drinks (any, incl. future): as many full crates of 6 as possible, the
 * remainder as loose bottles. Botanas: sacks of 100.
 */
export function packUnits(productId: string, units: number): Array<{ kind: PackageKind; units: number }> {
  const n = normalizeOrderUnits(productId, units);
  const out: Array<{ kind: PackageKind; units: number }> = [];
  if (n <= 0) return out;
  if (isSnackProduct(productId)) {
    for (let i = 0; i < n / PACKAGING.snackSackUnits; i++) out.push({ kind: 'sack', units: PACKAGING.snackSackUnits });
    return out;
  }
  const per = PACKAGING.drinkCrateUnits;
  const crates = Math.floor(n / per);
  const bottles = n - crates * per;
  for (let i = 0; i < crates; i++) out.push({ kind: 'crate', units: per });
  for (let i = 0; i < bottles; i++) out.push({ kind: 'bottle', units: 1 });
  return out;
}

export function packSummary(productId: string, units: number): { crates: number; bottles: number; sacks: number } {
  const p = packUnits(productId, units);
  return {
    crates: p.filter((x) => x.kind === 'crate').length,
    bottles: p.filter((x) => x.kind === 'bottle').length,
    sacks: p.filter((x) => x.kind === 'sack').length,
  };
}

export function describePackages(list: Array<{ kind: PackageKind }>): string {
  const c = list.filter((x) => x.kind === 'crate').length;
  const b = list.filter((x) => x.kind === 'bottle').length;
  const s = list.filter((x) => x.kind === 'sack').length;
  const parts: string[] = [];
  if (c) parts.push(`${c} ${c === 1 ? 'caja' : 'cajas'}`);
  if (b) parts.push(`${b} ${b === 1 ? 'botella' : 'botellas'}`);
  if (s) parts.push(`${s} ${s === 1 ? 'costal' : 'costales'}`);
  return parts.join(', ') || 'nada';
}

export function unitCost(productId: string): number {
  return getDrinkProduct(productId)?.supplierCost ?? getSnackProduct(productId)?.supplierCost ?? 0;
}

/** Same rounding as the old instant restock: supplierCost × units, rounded, ≥ $1 per line. */
export function lineCost(productId: string, units: number): number {
  const n = normalizeOrderUnits(productId, units);
  if (n <= 0) return 0;
  return Math.max(1, Math.round(unitCost(productId) * n));
}

export function orderCost(lines: OrderLine[]): number {
  return lines.reduce((a, l) => a + lineCost(l.productId, l.units), 0);
}

/** Working day = prep (closed, clock ticking) or open. Closing / summary = after closing. */
export function isWorkingDay(state: ShiftState): boolean {
  return state === 'closed' || state === 'open';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clockPlus(hour: number, minute: number, add: number): string {
  const t = (((hour * 60 + minute + add) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/** Plain-language delivery estimate for the confirm window / toast. */
export function estimateDeliveryText(state: ShiftState, hour: number, minute: number): string {
  if (isWorkingDay(state)) {
    const [a, b] = DELIVERY_TIMING.workingDayMinutes;
    return `Llega hoy, aprox. entre las ${clockPlus(hour, minute, a)} y las ${clockPlus(hour, minute, b)}.`;
  }
  const [a, b] = DELIVERY_TIMING.nextDayMinutesAfterStart;
  return `Llega mañana por la tarde (entre las ${clockPlus(17, 0, a)} y las ${clockPlus(17, 0, b)}).`;
}

function randInt(range: readonly [number, number], rng: () => number): number {
  return range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
}

export function getAbsMinute(): number {
  return absMinute;
}

/** Create a pending order (money is handled by the caller, once). */
export function createOrder(
  lines: OrderLine[],
  ctx: { state: ShiftState; day: number; clock: string; rng?: () => number }
): PendingOrder {
  const rng = ctx.rng ?? Math.random;
  const clean = lines
    .map((l) => ({ productId: l.productId, units: normalizeOrderUnits(l.productId, l.units) }))
    .filter((l) => l.units > 0);
  const working = isWorkingDay(ctx.state);
  const o: PendingOrder = {
    id: `ord_${++seq}`,
    lines: clean,
    cost: orderCost(clean),
    placedDay: ctx.day,
    placedClock: ctx.clock,
    nextDay: !working,
    dueAbs: working ? absMinute + randInt(DELIVERY_TIMING.workingDayMinutes, rng) : null,
    status: 'in_transit',
  };
  orders.push(o);
  return o;
}

/**
 * Advance the delivery clock by whole game minutes (only called while the shift clock ticks:
 * prep / open / closing — never in the closed night / summary). Returns orders now due.
 */
export function tickDeliveryMinutes(minutes: number): PendingOrder[] {
  const n = Math.max(0, Math.floor(minutes));
  if (n <= 0) return [];
  absMinute += n;
  const due: PendingOrder[] = [];
  for (const o of orders) {
    if (o.status !== 'in_transit' || o.dueAbs == null) continue;
    if (absMinute >= o.dueAbs) {
      o.status = 'arriving';
      due.push(o);
    }
  }
  return due;
}

/** Night is over (summary): anything not delivered yet comes tomorrow afternoon. */
export function deferUndeliveredToNextDay(): void {
  for (const o of orders) {
    if (o.status === 'in_transit') {
      o.nextDay = true;
      o.dueAbs = null;
    }
  }
}

/** New day at 17:00: schedule next-day orders inside the afternoon window. */
export function scheduleNextDayOrders(rng: () => number = Math.random): void {
  for (const o of orders) {
    if (o.status === 'in_transit' && o.dueAbs == null) {
      o.dueAbs = absMinute + randInt(DELIVERY_TIMING.nextDayMinutesAfterStart, rng);
    }
  }
}

export function removeOrder(id: string): void {
  orders = orders.filter((o) => o.id !== id);
}

export function listOrders(): PendingOrder[] {
  return orders;
}

export function addGoods(item: Omit<GoodsItem, 'id' | 'claimedBy' | 'carriedBy'>): GoodsItem {
  const g: GoodsItem = { ...item, id: `pkg_${++seq}`, claimedBy: null, carriedBy: null };
  goods.push(g);
  return g;
}

export function listGoods(): GoodsItem[] {
  return goods;
}

export function getGoods(id: string): GoodsItem | undefined {
  return goods.find((g) => g.id === id);
}

export function goodsOnFloor(): GoodsItem[] {
  return goods.filter((g) => !g.carriedBy);
}

/** Valid trip load: exactly 1 crate, or 1 sack, or 1–2 loose bottles. Nothing else. */
export function isValidCarryLoad(items: Array<{ kind: PackageKind }>): boolean {
  if (items.length === 1) return true;
  if (items.length === 2) return items.every((i) => i.kind === 'bottle');
  return false;
}

/** Package arrived behind the bar: it leaves the goods list (caller adds stock). */
export function consumeStoredGoods(id: string, by: string, at: number): GoodsItem | null {
  const i = goods.findIndex((g) => g.id === id);
  if (i < 0) return null;
  const [g] = goods.splice(i, 1);
  storedLog.push({ productId: g.productId, units: g.units, by, at });
  if (storedLog.length > 200) storedLog.shift();
  return g;
}

/** Units per product still on the way (paid, supplier not here yet). */
export function unitsInTransit(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders) for (const l of o.lines) out[l.productId] = (out[l.productId] ?? 0) + l.units;
  return out;
}

/** Units per product sitting at the entrance (or being carried). */
export function unitsAtEntrance(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of goods) out[g.productId] = (out[g.productId] ?? 0) + g.units;
  return out;
}

export function serializeDeliveries(): DeliveriesSave {
  return {
    absMinute,
    seq,
    // An order whose supplier was mid-walk is restored as due now (goods are never lost).
    orders: orders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })),
    // Carried packages are saved back on the floor where they were picked up.
    goods: goods.map((g) => ({ ...g, claimedBy: null, carriedBy: null })),
  };
}

export function loadDeliveries(raw: unknown): void {
  absMinute = 0;
  seq = 0;
  orders = [];
  goods = [];
  if (!raw || typeof raw !== 'object') return;
  const o = raw as DeliveriesSave;
  if (typeof o.absMinute === 'number' && Number.isFinite(o.absMinute)) absMinute = Math.max(0, Math.floor(o.absMinute));
  if (typeof o.seq === 'number' && Number.isFinite(o.seq)) seq = Math.max(0, Math.floor(o.seq));
  if (Array.isArray(o.orders)) {
    for (const r of o.orders) {
      if (!r || typeof r.id !== 'string' || !Array.isArray(r.lines)) continue;
      orders.push({
        id: r.id,
        lines: r.lines
          .filter((l) => l && typeof l.productId === 'string' && typeof l.units === 'number')
          .map((l) => ({ productId: l.productId, units: Math.max(0, Math.floor(l.units)) })),
        cost: typeof r.cost === 'number' ? r.cost : 0,
        placedDay: typeof r.placedDay === 'number' ? r.placedDay : 1,
        placedClock: typeof r.placedClock === 'string' ? r.placedClock : '',
        nextDay: !!r.nextDay,
        dueAbs: typeof r.dueAbs === 'number' ? r.dueAbs : null,
        // A supplier caught mid-walk by a reload delivers right away.
        status: 'in_transit',
      });
      const last = orders[orders.length - 1];
      if (r.status === 'arriving') last.dueAbs = absMinute;
    }
  }
  if (Array.isArray(o.goods)) {
    for (const g of o.goods) {
      if (!g || typeof g.id !== 'string' || typeof g.productId !== 'string') continue;
      if (g.kind !== 'crate' && g.kind !== 'bottle' && g.kind !== 'sack') continue;
      goods.push({
        id: g.id,
        productId: g.productId,
        kind: g.kind,
        units: Math.max(1, Math.floor(g.units || 1)),
        col: Math.floor(g.col || 0),
        row: Math.floor(g.row || 0),
        slot: Math.floor(g.slot || 0),
        orderId: typeof g.orderId === 'string' ? g.orderId : '',
        claimedBy: null,
        carriedBy: null,
      });
    }
  }
}

export function getDeliveriesDebug() {
  return {
    absMinute,
    orders: orders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })),
    goods: goods.map((g) => ({ ...g })),
    inTransit: unitsInTransit(),
    atEntrance: unitsAtEntrance(),
    stored: [...storedLog],
  };
}
