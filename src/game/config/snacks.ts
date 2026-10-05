/**
 * Botanas (snacks) — consumable product category.
 * Gated: cannot buy without ≥1 functional table (mesa_*).
 * Utility: seated at a table → optional snack → slight sat + longer stay.
 */

export interface SnackProduct {
  id: string;
  name: string;
  supplierCost: number;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  priceStep: number;
  /** Starting stock (0 — must buy; no magic stock). */
  startStock: number;
  /** Chance a seated table patron tries to buy a snack (if stock > 0). */
  orderChance: number;
}

export const SNACKS_CATALOG: readonly SnackProduct[] = [
  {
    id: 'botanas',
    name: 'Botanas',
    supplierCost: 2,
    basePrice: 5,
    minPrice: 2,
    maxPrice: 14,
    priceStep: 1,
    startStock: 0,
    orderChance: 0.42,
  },
] as const;

export type SnackId = (typeof SNACKS_CATALOG)[number]['id'];

const byId = new Map<string, SnackProduct>(SNACKS_CATALOG.map((s) => [s.id, s]));

export function getSnackProduct(id: string): SnackProduct | undefined {
  return byId.get(id);
}

export function listSnackProducts(): SnackProduct[] {
  return SNACKS_CATALOG.map((s) => ({ ...s }));
}

/** Furniture catalog ids that count as a valid table for unlocking botanas. */
export const TABLE_CATALOG_IDS = new Set([
  'mesa_pequena',
  'mesa_grande',
  'mesa_vip',
]);

export function isTableCatalogId(id: string | undefined | null): boolean {
  if (!id) return false;
  return TABLE_CATALOG_IDS.has(id.toLowerCase());
}

/** Subtle experience when a seated patron eats botanas. */
export const SNACK_EXPERIENCE = {
  /** One-shot sat delta key snack:botanas. */
  satDelta: 3.0,
  /** Extra sit time multiplier (1.18 = +18%). */
  sitDurationMult: 1.18,
  /** Extra sit ms clamped range bump. */
  sitDurationBonusMs: 1800,
} as const;

/** UI copy when botanas are locked. */
export const SNACK_LOCKED_HINT = 'Necesitas una mesa.';
