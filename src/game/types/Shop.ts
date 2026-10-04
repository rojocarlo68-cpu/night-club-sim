/** Catalog entry for Construir furniture/decor shop (data-driven). Every piece has ONE fixed
 *  SE orientation (no rotation): `sprite` is its SE art. */

export interface ShopFurnitureItem {
  id: string;
  name: string;
  price: number;
  /** UI section: muebles | decoracion */
  category: 'muebles' | 'decoracion' | string;
  /** Phaser texture key (default / shop thumb) */
  sprite: string;
  spriteFile?: string;
  footprint: [number, number];
  displaySize: [number, number];
  /** Subtracted from tile screen Y when placing. */
  yBias?: number;
  /**
   * Art-pixel position (2x texture px from top-left) of the sprite's lowest base vertex. When set,
   * that vertex is pinned to the footprint's bottom vertex (sofa-style exact tile snapping).
   */
  baseVertex?: [number, number];
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
