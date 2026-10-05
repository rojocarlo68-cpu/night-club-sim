/**
 * Club drink + snack inventory.
 * Drinks: existing cerveza/refresco/… catalogue.
 * Snacks (botanas): gated purchase (needs a table); startStock 0.
 */

import {
  DRINKS_CATALOG,
  DrinkProduct,
  getDrinkProduct,
  listDrinkProducts,
} from '../config/drinks';
import {
  SNACKS_CATALOG,
  SnackProduct,
  getSnackProduct,
  listSnackProducts,
} from '../config/snacks';

export type InventoryKind = 'drink' | 'snack';

export interface InventoryLine {
  id: string;
  name: string;
  kind: InventoryKind;
  stock: number;
  soldTonight: number;
  revenueTonight: number;
  supplierCost: number;
  price: number;
  margin: number;
  minPrice: number;
  maxPrice: number;
  priceStep: number;
  /** UI: botanas locked until the club has a table. */
  locked?: boolean;
  lockHint?: string;
}

interface ProductState {
  stock: number;
  soldTonight: number;
  revenueTonight: number;
  price: number;
}

export type InventorySave = {
  stock?: Record<string, number>;
  prices?: Record<string, number>;
};

const state: Record<string, ProductState> = {};
let ready = false;
const stockoutFirstMs: Record<string, number> = {};

type AnyProduct = DrinkProduct | SnackProduct;

function allProducts(): AnyProduct[] {
  return [...DRINKS_CATALOG, ...SNACKS_CATALOG];
}

function getProduct(id: string): AnyProduct | undefined {
  return getDrinkProduct(id) ?? getSnackProduct(id);
}

function productKind(id: string): InventoryKind {
  return getSnackProduct(id) ? 'snack' : 'drink';
}

function ensureAll(): void {
  if (ready) return;
  for (const d of allProducts()) {
    if (!state[d.id]) {
      state[d.id] = {
        stock: Math.max(0, Math.floor(d.startStock)),
        soldTonight: 0,
        revenueTonight: 0,
        price: d.basePrice,
      };
    }
  }
  ready = true;
}

function clampPrice(d: AnyProduct, raw: number): number {
  if (!Number.isFinite(raw)) return d.basePrice;
  const stepped = Math.round(raw / d.priceStep) * d.priceStep;
  return Math.min(d.maxPrice, Math.max(d.minPrice, stepped));
}

export function initInventory(): void {
  ensureAll();
}

export function getStock(id: string): number {
  ensureAll();
  return state[id]?.stock ?? 0;
}

export function getPrice(id: string): number {
  ensureAll();
  const d = getProduct(id);
  if (!d) return state[id]?.price ?? 0;
  return state[id]?.price ?? d.basePrice;
}

export function margin(id: string): number {
  ensureAll();
  const d = getProduct(id);
  if (!d) return 0;
  return getPrice(id) - d.supplierCost;
}

export function canSell(id: string): boolean {
  ensureAll();
  return getStock(id) > 0;
}

export function recordSale(id: string, units = 1): boolean {
  ensureAll();
  const d = getProduct(id);
  const s = state[id];
  if (!d || !s) return false;
  const n = Math.max(0, Math.floor(units));
  if (n <= 0 || s.stock < n) return false;
  s.stock -= n;
  if (s.stock < 0) s.stock = 0;
  s.soldTonight += n;
  s.revenueTonight += n * s.price;
  if (s.stock === 0 && stockoutFirstMs[id] == null) {
    stockoutFirstMs[id] = Date.now();
  }
  return true;
}

/** Night counters for pre-poured items, waste (merma) and staff consumption. */
const wasteTonight: Record<string, number> = {};
const wasteCostTonight: Record<string, number> = {};
const staffUseTonight: Record<string, number> = {};
const staffRevenueTonight: Record<string, number> = {};

/**
 * Take units out of stock WITHOUT a sale (pre-pour a beer / prepare a plate).
 * The sale is recorded later with recordPrepouredSale, or the unit becomes merma.
 */
export function withdrawStock(id: string, units = 1): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getProduct(id)) return false;
  const n = Math.max(0, Math.floor(units));
  if (n <= 0 || s.stock < n) return false;
  s.stock -= n;
  if (s.stock === 0 && stockoutFirstMs[id] == null) stockoutFirstMs[id] = Date.now();
  return true;
}

/** A pre-poured unit was bought by a customer (stock already withdrawn). */
export function recordPrepouredSale(id: string, units = 1): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getProduct(id)) return false;
  const n = Math.max(0, Math.floor(units));
  s.soldTonight += n;
  s.revenueTonight += n * s.price;
  return true;
}

/** A withdrawn unit spoiled / was spilled (merma). Money is not recovered. */
export function recordWaste(id: string, units = 1): void {
  ensureAll();
  const n = Math.max(0, Math.floor(units));
  if (n <= 0) return;
  wasteTonight[id] = (wasteTonight[id] ?? 0) + n;
  wasteCostTonight[id] = (wasteCostTonight[id] ?? 0) + n * (getProduct(id)?.supplierCost ?? 0);
}

/** Staff bought one unit with her own money (internal consumption; club gets paid). */
export function recordStaffConsumption(id: string, paid: number): boolean {
  ensureAll();
  const s = state[id];
  if (!s || s.stock < 1) return false;
  s.stock -= 1;
  if (s.stock === 0 && stockoutFirstMs[id] == null) stockoutFirstMs[id] = Date.now();
  staffUseTonight[id] = (staffUseTonight[id] ?? 0) + 1;
  staffRevenueTonight[id] = (staffRevenueTonight[id] ?? 0) + paid;
  return true;
}

export function getNightWaste(): { units: Record<string, number>; cost: number } {
  return {
    units: { ...wasteTonight },
    cost: Object.values(wasteCostTonight).reduce((a, b) => a + b, 0),
  };
}

export function getNightStaffConsumption(): { units: Record<string, number>; revenue: number } {
  return {
    units: { ...staffUseTonight },
    revenue: Object.values(staffRevenueTonight).reduce((a, b) => a + b, 0),
  };
}

export function resetNightInventory(): void {
  ensureAll();
  for (const id of Object.keys(state)) {
    state[id].soldTonight = 0;
    state[id].revenueTonight = 0;
  }
  for (const o of [wasteTonight, wasteCostTonight, staffUseTonight, staffRevenueTonight]) {
    for (const k of Object.keys(o)) delete o[k];
  }
  clearStockoutFirstMs();
}

export function setPrice(id: string, price: number): boolean {
  ensureAll();
  const d = getProduct(id);
  const s = state[id];
  if (!d || !s) return false;
  s.price = clampPrice(d, price);
  return true;
}

export function addStock(id: string, units: number): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getProduct(id)) return false;
  const n = Math.max(0, Math.floor(units));
  if (n <= 0) return false;
  s.stock += n;
  return true;
}

export function setStock(id: string, units: number): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getProduct(id)) return false;
  s.stock = Math.max(0, Math.floor(units));
  if (s.stock === 0 && stockoutFirstMs[id] == null) {
    stockoutFirstMs[id] = Date.now();
  }
  return true;
}

export function isSnackId(id: string): boolean {
  return !!getSnackProduct(id);
}

/**
 * List drinks + snacks for the inventory UI.
 * @param snacksUnlocked — when false, botanas rows show locked (cannot restock).
 */
export function listInventory(opts?: {
  snacksUnlocked?: boolean;
  snackLockHint?: string;
}): InventoryLine[] {
  ensureAll();
  const snacksUnlocked = opts?.snacksUnlocked !== false;
  const lockHint = opts?.snackLockHint ?? 'Necesitas una mesa.';
  const drinks = listDrinkProducts().map((d) => {
    const s = state[d.id];
    const price = s?.price ?? d.basePrice;
    return {
      id: d.id,
      name: d.name,
      kind: 'drink' as const,
      stock: s?.stock ?? 0,
      soldTonight: s?.soldTonight ?? 0,
      revenueTonight: s?.revenueTonight ?? 0,
      supplierCost: d.supplierCost,
      price,
      margin: price - d.supplierCost,
      minPrice: d.minPrice,
      maxPrice: d.maxPrice,
      priceStep: d.priceStep,
    };
  });
  const snacks = listSnackProducts().map((d) => {
    const s = state[d.id];
    const price = s?.price ?? d.basePrice;
    const locked = !snacksUnlocked;
    return {
      id: d.id,
      name: d.name,
      kind: 'snack' as const,
      stock: s?.stock ?? 0,
      soldTonight: s?.soldTonight ?? 0,
      revenueTonight: s?.revenueTonight ?? 0,
      supplierCost: d.supplierCost,
      price,
      margin: price - d.supplierCost,
      minPrice: d.minPrice,
      maxPrice: d.maxPrice,
      priceStep: d.priceStep,
      locked,
      lockHint: locked ? lockHint : undefined,
    };
  });
  return [...drinks, ...snacks];
}

export function serializeInventory(): InventorySave {
  ensureAll();
  const stock: Record<string, number> = {};
  const prices: Record<string, number> = {};
  for (const d of allProducts()) {
    const s = state[d.id];
    if (!s) continue;
    stock[d.id] = s.stock | 0;
    prices[d.id] = s.price;
  }
  return { stock, prices };
}

export function loadInventory(raw: unknown): void {
  for (const k of Object.keys(state)) delete state[k];
  ready = false;
  ensureAll();
  if (!raw || typeof raw !== 'object') return;
  const o = raw as InventorySave;
  const stockSrc = o.stock && typeof o.stock === 'object' ? o.stock : null;
  const priceSrc = o.prices && typeof o.prices === 'object' ? o.prices : null;
  for (const d of allProducts()) {
    const s = state[d.id];
    if (!s) continue;
    if (stockSrc && typeof stockSrc[d.id] === 'number' && Number.isFinite(stockSrc[d.id])) {
      s.stock = Math.max(0, Math.floor(stockSrc[d.id] as number));
    }
    if (priceSrc && typeof priceSrc[d.id] === 'number' && Number.isFinite(priceSrc[d.id])) {
      s.price = clampPrice(d, priceSrc[d.id] as number);
    }
    s.soldTonight = 0;
    s.revenueTonight = 0;
  }
}

export function getInventoryDebug() {
  return {
    lines: listInventory({ snacksUnlocked: true }),
    save: serializeInventory(),
  };
}

export function getStockoutFirstMs(): Record<string, number> {
  return { ...stockoutFirstMs };
}

export function clearStockoutFirstMs(): void {
  for (const k of Object.keys(stockoutFirstMs)) delete stockoutFirstMs[k];
}

/** Supplier cost for restock (drink or snack). */
export function getSupplierCost(id: string): number {
  const d = getProduct(id);
  return d?.supplierCost ?? 0;
}

export function productExists(id: string): boolean {
  return !!getProduct(id);
}

void productKind;
