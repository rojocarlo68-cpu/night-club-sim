/**
 * Served/prepared products waiting for a customer (beer mugs, botanas plates).
 * Stock is already withdrawn from the real inventory when the item is created.
 * fresh → stale (penalty) → spoiled (refused → merma). Visuals live in ClubScene.
 */
import { SPOIL_PROFILES, MAX_ITEMS_PER_SPOT, SpoilProfile } from '../config/spoilage';

export type ServedState = 'fresh' | 'stale' | 'spoiled';

export interface ServedItem {
  id: string;
  productId: string;
  createdAt: number;
  /** 'tap:<fid>' | 'bar:<fid>' | 'table:<fid>' */
  spot: string;
  col: number;
  row: number;
  pouredBy: string;
  /** Spoil already processed (dirt added / merma counted on removal). */
  spoiledNotified: boolean;
}

let items: ServedItem[] = [];
let seq = 0;

export function profileFor(productId: string): SpoilProfile | undefined {
  return SPOIL_PROFILES[productId];
}

export function stateOf(it: ServedItem, now: number): ServedState {
  const p = profileFor(it.productId);
  if (!p) return 'fresh';
  const age = now - it.createdAt;
  if (age < p.freshMs) return 'fresh';
  if (age < p.staleMs) return 'stale';
  return 'spoiled';
}

export function canAddAt(spot: string): boolean {
  return items.filter((i) => i.spot === spot).length < MAX_ITEMS_PER_SPOT;
}

export function addServedItem(
  productId: string,
  spot: string,
  tile: { col: number; row: number },
  pouredBy: string,
  now: number
): ServedItem {
  const it: ServedItem = {
    id: `srv_${++seq}`,
    productId,
    createdAt: now,
    spot,
    col: tile.col,
    row: tile.row,
    pouredBy,
    spoiledNotified: false,
  };
  items.push(it);
  return it;
}

export function listServed(): ServedItem[] {
  return items;
}

export function itemsAt(spotPrefix: string): ServedItem[] {
  return items.filter((i) => i.spot === spotPrefix || i.spot.startsWith(spotPrefix));
}

/**
 * Claim the oldest still-acceptable item of `productId` whose spot matches one of `spots`
 * (FIFO minimises waste). Spoiled items are never accepted.
 */
export function claimServed(productId: string, spots: string[], now: number): { item: ServedItem; state: ServedState } | null {
  const cands = items
    .filter((i) => i.productId === productId && spots.some((s) => i.spot === s || i.spot.startsWith(s)))
    .map((i) => ({ item: i, state: stateOf(i, now) }))
    .filter((x) => x.state !== 'spoiled')
    .sort((a, b) => a.item.createdAt - b.item.createdAt);
  const pick = cands[0];
  if (!pick) return null;
  removeServed(pick.item.id);
  return pick;
}

export function removeServed(id: string): ServedItem | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [it] = items.splice(i, 1);
  return it;
}

/** Newly spoiled items (once) + spoiled items due for auto-collection (merma). */
export function tickServed(now: number): { newlySpoiled: ServedItem[]; collect: ServedItem[] } {
  const newlySpoiled: ServedItem[] = [];
  const collect: ServedItem[] = [];
  for (const it of items) {
    const p = profileFor(it.productId);
    if (!p) continue;
    if (stateOf(it, now) !== 'spoiled') continue;
    if (!it.spoiledNotified) {
      it.spoiledNotified = true;
      newlySpoiled.push(it);
    }
    if (now - it.createdAt >= p.staleMs + p.removeAfterSpoiledMs) collect.push(it);
  }
  return { newlySpoiled, collect };
}

/** Remove everything (end of night → all leftovers are merma). */
export function clearServed(): ServedItem[] {
  const out = items;
  items = [];
  return out;
}

export function getServedDebug(now: number) {
  return items.map((i) => ({ ...i, state: stateOf(i, now), ageMs: Math.round(now - i.createdAt) }));
}
