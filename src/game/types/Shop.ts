/** Catalog entry for Construir furniture/decor shop (data-driven). */
export type ShopFacingSupport = 'full' | 'flip' | 'none';

export interface ShopFurnitureItem {
  id: string;
  name: string;
  price: number;
  /** UI section: muebles | decoracion */
  category: 'muebles' | 'decoracion' | string;
  /** Phaser texture key */
  sprite: string;
  spriteFile?: string;
  footprint: [number, number];
  displaySize: [number, number];
  /** Subtracted from tile screen Y when placing. */
  yBias?: number;
  /**
   * full = 4 iso angles; flip = mirror one sprite; none = no rotate.
   * Mesa de DJ currently ships with one angle — flip until Carlo sends more.
   */
  facingSupport: ShopFacingSupport;
  defaultFacing?: 'se' | 'sw' | 'ne' | 'nw';
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
