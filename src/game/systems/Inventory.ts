/**
 * Club drink inventory (Prompt A Phase 3).
 * Stock + nightly sold/revenue + public prices.
 * recordSale() is ready but NOT called until Phase 4 wires serving.
 */

import {
  DRINKS_CATALOG,
  DrinkProduct,
  getDrinkProduct,
  listDrinkProducts,
} from '../config/drinks';

export interface InventoryLine {
  id: string;
  name: string;
  stock: number;
  soldTonight: number;
  revenueTonight: number;
  supplierCost: number;
  price: number;
  margin: number;
  minPrice: number;
  maxPrice: number;
  priceStep: number;
}

interface ProductState {
  stock: number;
  soldTonight: number;
  revenueTonight: number;
  /** Current public sale price (defaults to basePrice). */
  price: number;
}

/** Persistable shape (stock + prices only; nightly counters are ephemeral). */
export type InventorySave = {
  stock?: Record<string, number>;
  prices?: Record<string, number>;
};

const state: Record<string, ProductState> = {};
let ready = false;
/** First Date.now() each product hit stock 0 this night (Prompt A Phase 10). */
const stockoutFirstMs: Record<string, number> = {};

function ensureAll(): void {
  if (ready) return;
  for (const d of DRINKS_CATALOG) {
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

function clampPrice(d: DrinkProduct, raw: number): number {
  if (!Number.isFinite(raw)) return d.basePrice;
  const stepped = Math.round(raw / d.priceStep) * d.priceStep;
  return Math.min(d.maxPrice, Math.max(d.minPrice, stepped));
}

/** Idempotent: fill missing products with catalogue defaults. */
export function initInventory(): void {
  ensureAll();
}

export function getStock(id: string): number {
  ensureAll();
  return state[id]?.stock ?? 0;
}

export function getPrice(id: string): number {
  ensureAll();
  const d = getDrinkProduct(id);
  if (!d) return state[id]?.price ?? 0;
  return state[id]?.price ?? d.basePrice;
}

/** Gross margin per unit at the current public price. */
export function margin(id: string): number {
  ensureAll();
  const d = getDrinkProduct(id);
  if (!d) return 0;
  return getPrice(id) - d.supplierCost;
}

export function canSell(id: string): boolean {
  ensureAll();
  return getStock(id) > 0;
}

/**
 * Decrement stock (clamped ≥ 0), bump soldTonight + revenueTonight.
 * Phase 3: exported but NOT called from serve path yet.
 */
export function recordSale(id: string, units = 1): boolean {
  ensureAll();
  const d = getDrinkProduct(id);
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

/** Zero nightly sold/revenue; keep stock + prices. Call from openNight. */
export function resetNightInventory(): void {
  ensureAll();
  for (const id of Object.keys(state)) {
    state[id].soldTonight = 0;
    state[id].revenueTonight = 0;
  }
  clearStockoutFirstMs();
}

/** Player price edit (Phase 5 UI). Safe to call; unused in Phase 3 UI. */
export function setPrice(id: string, price: number): boolean {
  ensureAll();
  const d = getDrinkProduct(id);
  const s = state[id];
  if (!d || !s) return false;
  s.price = clampPrice(d, price);
  return true;
}

/** Restock helper (Phase 4 UI + ClubScene.restockDrink). */
export function addStock(id: string, units: number): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getDrinkProduct(id)) return false;
  const n = Math.max(0, Math.floor(units));
  if (n <= 0) return false;
  s.stock += n;
  return true;
}

/** Debug/test: set absolute stock (never negative). */
export function setStock(id: string, units: number): boolean {
  ensureAll();
  const s = state[id];
  if (!s || !getDrinkProduct(id)) return false;
  s.stock = Math.max(0, Math.floor(units));
  if (s.stock === 0 && stockoutFirstMs[id] == null) {
    stockoutFirstMs[id] = Date.now();
  }
  return true;
}

export function listInventory(): InventoryLine[] {
  ensureAll();
  return listDrinkProducts().map((d) => {
    const s = state[d.id];
    const price = s?.price ?? d.basePrice;
    return {
      id: d.id,
      name: d.name,
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
}

export function serializeInventory(): InventorySave {
  ensureAll();
  const stock: Record<string, number> = {};
  const prices: Record<string, number> = {};
  for (const d of DRINKS_CATALOG) {
    const s = state[d.id];
    if (!s) continue;
    stock[d.id] = s.stock | 0;
    prices[d.id] = s.price;
  }
  return { stock, prices };
}

/** Load from save; missing products keep catalogue startStock / basePrice. */
export function loadInventory(raw: unknown): void {
  // Reset then apply save so removed products don't linger.
  for (const k of Object.keys(state)) delete state[k];
  ready = false;
  ensureAll();
  if (!raw || typeof raw !== 'object') return;
  const o = raw as InventorySave;
  const stockSrc = o.stock && typeof o.stock === 'object' ? o.stock : null;
  const priceSrc = o.prices && typeof o.prices === 'object' ? o.prices : null;
  for (const d of DRINKS_CATALOG) {
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

/** Debug snapshot for window.__NC_GAME__ tests. */
export function getInventoryDebug() {
  return {
    lines: listInventory(),
    save: serializeInventory(),
  };
}

/** Prompt A Phase 10: first stockout timestamps this night. */
export function getStockoutFirstMs(): Record<string, number> {
  return { ...stockoutFirstMs };
}

export function clearStockoutFirstMs(): void {
  for (const k of Object.keys(stockoutFirstMs)) delete stockoutFirstMs[k];
}
