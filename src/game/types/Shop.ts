/** Catalog entry for Construir furniture/decor shop (data-driven). */
export type ShopFacingSupport = 'full' | 'flip' | 'none';

export type ShopIsoFacing = 'se' | 'sw' | 'ne' | 'nw';

export interface ShopFurnitureItem {
  id: string;
  name: string;
  price: number;
  /** UI section: muebles | decoracion */
  category: 'muebles' | 'decoracion' | string;
  /** Phaser texture key (default / shop thumb) */
  sprite: string;
  spriteFile?: string;
  /** Optional 4-dir texture map (full facingSupport). */
  sprites?: Partial<Record<ShopIsoFacing, string>>;
  footprint: [number, number];
  displaySize: [number, number];
  /** Subtracted from tile screen Y when placing. */
  yBias?: number;
  /**
   * full = 4 iso angles; flip = mirror one sprite; none = no rotate.
   */
  facingSupport: ShopFacingSupport;
  defaultFacing?: ShopIsoFacing;
  blurb?: string;
}

export interface ShopFurnitureFile {
  items: ShopFurnitureItem[];
}

/** Payload for UI shop panel. */
export interface ShopCatalogPayload {
  money: number;
  items: Array<
    ShopFurnitureItem & {
      ownedCount: number;
      canBuy: boolean;
    }
  >;
}
