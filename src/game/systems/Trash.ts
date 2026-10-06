/**
 * Customer trash (logic only; visuals / staff in ClubScene).
 * consumption → (chance) 1 piece → container (if any, most of it) or floor → staff pick it up
 * into ONE club-wide bag → bag full (capacity rolled once per bag) → full bag sits in the club
 * and blocks pickup → "Sacar basura" → staff outside ~20 s → back → new bag cycle.
 */
import { TRASH, TrashKind } from '../config/logistics';

export interface TrashItem {
  id: string;
  kind: TrashKind;
  col: number;
  row: number;
  /** Pixel offset inside the tile (visual scatter). */
  ox: number;
  oy: number;
  productId: string;
  createdAt: number;
  claimedBy: string | null;
}

export interface FullBag {
  id: string;
  col: number;
  row: number;
  claimedBy: string | null;
  carriedBy: string | null;
}

export interface BagState {
  capacity: number;
  count: number;
  /** Container existed when this bag's capacity was rolled. */
  rolledWithContainer: boolean;
  cycle: number;
}

export interface TrashSave {
  seq?: number;
  items?: TrashItem[];
  bag?: BagState | null;
  fullBag?: FullBag | null;
}

let seq = 0;
let items: TrashItem[] = [];
let bag: BagState | null = null;
let fullBag: FullBag | null = null;
/** Staff currently outside with the bag (pickup stays blocked until she is back). */
let outBy: string | null = null;
/** True while a filled bag is being carried to its resting spot (not yet on the floor). */
let bagInTransitBy: string | null = null;
const night = { generated: 0, toFloor: 0, toContainer: 0, picked: 0, bagsOut: 0 };
const capacityLog: Array<{ cycle: number; capacity: number; container: boolean }> = [];

export function rollBagCapacity(hasContainer: boolean, rng: () => number = Math.random): number {
  const r = hasContainer ? TRASH.bagCapacity.container : TRASH.bagCapacity.noContainer;
  return r[0] + Math.floor(rng() * (r[1] - r[0] + 1));
}

/** Start a new bag cycle (capacity rolled ONCE here). */
export function startNewBag(hasContainer: boolean, rng: () => number = Math.random): BagState {
  const cycle = (bag?.cycle ?? 0) + 1;
  bag = { capacity: rollBagCapacity(hasContainer, rng), count: 0, rolledWithContainer: hasContainer, cycle };
  capacityLog.push({ cycle, capacity: bag.capacity, container: hasContainer });
  if (capacityLog.length > 50) capacityLog.shift();
  return bag;
}

export function ensureBag(hasContainer: boolean): BagState {
  return bag ?? startNewBag(hasContainer);
}

export function getBag(): BagState | null {
  return bag;
}

export function getFullBag(): FullBag | null {
  return fullBag;
}

export function trashOutBy(): string | null {
  return outBy;
}

/** Pickup allowed only with a bag that has room and no full bag waiting / outside. */
export function canPickUpTrash(): boolean {
  return !!bag && bag.count < bag.capacity && !fullBag && !outBy && !bagInTransitBy;
}

/** Why pickup is blocked (Spanish, for menus). */
export function pickupBlockedReason(): string | null {
  if (fullBag || bagInTransitBy) return 'La bolsa está llena';
  if (outBy) return 'Están sacando la basura';
  if (!bag || bag.count >= bag.capacity) return 'La bolsa está llena';
  return null;
}

/** Roll whether a consumption leaves trash and where it goes. */
export function rollTrashFor(
  productId: string,
  hasContainer: boolean,
  rng: () => number = Math.random,
  chanceOverride?: number
): { kind: TrashKind; dest: 'floor' | 'container' } | null {
  const chance = chanceOverride ?? TRASH.chanceByProduct[productId] ?? TRASH.chanceByProduct.default;
  if (rng() >= chance) return null;
  const kinds = TRASH.kindsByProduct[productId] ?? TRASH.kindsByProduct.default;
  const kind = kinds[Math.floor(rng() * kinds.length)] ?? kinds[0];
  night.generated += 1;
  const dest: 'floor' | 'container' = hasContainer && rng() >= TRASH.containerFloorShare ? 'container' : 'floor';
  if (dest === 'container') night.toContainer += 1;
  else night.toFloor += 1;
  return { kind, dest };
}

export function addTrashItem(it: Omit<TrashItem, 'id' | 'claimedBy'>): TrashItem {
  const t: TrashItem = { ...it, id: `trash_${++seq}`, claimedBy: null };
  items.push(t);
  return t;
}

export function listTrash(): TrashItem[] {
  return items;
}

export function getTrash(id: string): TrashItem | undefined {
  return items.find((t) => t.id === id);
}

/**
 * A staff member picked up one piece into the club bag.
 * Returns 'ok' | 'full' (this piece filled it) | 'blocked' (could not; item stays).
 */
export function pickTrashIntoBag(id: string): 'ok' | 'full' | 'blocked' {
  const i = items.findIndex((t) => t.id === id);
  if (i < 0) return 'blocked';
  if (!canPickUpTrash() || !bag) return 'blocked';
  items.splice(i, 1);
  bag.count += 1;
  night.picked += 1;
  if (bag.count >= bag.capacity) return 'full';
  return 'ok';
}

/** The filled bag is being carried to its spot. */
export function markBagInTransit(staffId: string | null): void {
  bagInTransitBy = staffId;
}

export function placeFullBag(col: number, row: number): FullBag {
  bagInTransitBy = null;
  fullBag = { id: `bag_${++seq}`, col, row, claimedBy: null, carriedBy: null };
  return fullBag;
}

export function claimFullBag(staffId: string | null): void {
  if (fullBag) fullBag.claimedBy = staffId;
}

export function carryFullBag(staffId: string | null): void {
  if (fullBag) fullBag.carriedBy = staffId;
}

/** Interrupted mid-carry: the bag lands where she stands. */
export function dropFullBagAt(col: number, row: number): void {
  if (!fullBag) return;
  fullBag.col = col;
  fullBag.row = row;
  fullBag.claimedBy = null;
  fullBag.carriedBy = null;
}

/** She walked out of the club with the bag. Pickup stays blocked until she returns. */
export function bagLeftClub(staffId: string): void {
  fullBag = null;
  outBy = staffId;
  night.bagsOut += 1;
}

/** Back inside without the bag → a NEW bag cycle begins (capacity rolled once). */
export function bagCycleRestart(hasContainer: boolean): BagState {
  outBy = null;
  bagInTransitBy = null;
  return startNewBag(hasContainer);
}

export function resetTrashNight(): void {
  night.generated = 0;
  night.toFloor = 0;
  night.toContainer = 0;
  night.picked = 0;
  night.bagsOut = 0;
}

export function serializeTrash(): TrashSave {
  return {
    seq,
    items: items.map((t) => ({ ...t, claimedBy: null })),
    bag: bag ? { ...bag } : null,
    fullBag: fullBag ? { ...fullBag, claimedBy: null, carriedBy: null } : null,
  };
}

export function loadTrash(raw: unknown): void {
  seq = 0;
  items = [];
  bag = null;
  fullBag = null;
  outBy = null;
  bagInTransitBy = null;
  if (!raw || typeof raw !== 'object') return;
  const o = raw as TrashSave;
  if (typeof o.seq === 'number') seq = Math.max(0, Math.floor(o.seq));
  if (Array.isArray(o.items)) {
    for (const t of o.items) {
      if (!t || typeof t.id !== 'string') continue;
      items.push({ ...t, claimedBy: null });
    }
  }
  if (o.bag && typeof o.bag.capacity === 'number') bag = { ...o.bag };
  if (o.fullBag && typeof o.fullBag.id === 'string') fullBag = { ...o.fullBag, claimedBy: null, carriedBy: null };
}

export function getTrashDebug() {
  return {
    items: items.map((t) => ({ ...t })),
    bag: bag ? { ...bag } : null,
    fullBag: fullBag ? { ...fullBag } : null,
    outBy,
    bagInTransitBy,
    canPickUp: canPickUpTrash(),
    night: { ...night },
    capacityLog: [...capacityLog],
  };
}
