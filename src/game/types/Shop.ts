/** Catalog entry for Construir furniture/decor shop (data-driven). Every piece has ONE fixed
 *  orientation (no rotation, Ultima Online style): `sprite` is its only art. */

export type ShopCategory =
  | 'funcional'
  | 'ambiente'
  | 'entretenimiento'
  | 'identidad'
  /** Legacy tabs — mapped to funcional / ambiente in UI. */
  | 'muebles'
  | 'decoracion'
  | string;

export type ShopFunctionTag =
  | 'seating'
  | 'service_bar'
  | 'service_beer'
  | 'trash_bin'
  | 'service_snack_future'
  | 'service_aux_future'
  | 'decor'
  | 'entertainment_future'
  | 'identity'
  | string;

export interface ShopFurnitureItem {
  id: string;
  name: string;
  price: number;
  /** UI section: funcional | ambiente | entretenimiento | identidad (legacy muebles/decoracion OK). */
  category: ShopCategory;
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
  /** Gameplay role tag (seating, service_beer, decor, …). */
  function?: ShopFunctionTag;
  /** Optional comfort hint for seating (feeds price/stats; VIP higher). */
  comfortHint?: number;
  /** Purely decorative — no automatic +% demand. */
  decorative?: boolean;
  /** Unlock requirement catalog ids (future). */
  requires?: string[];
  /** Hex color for procedural placeholder when sprite art is missing. */
  placeholderColor?: number;
  /** Horizontal mirror (Voltear) allowed. Default true; set false for art that must never mirror. */
  flippable?: boolean;
  /**
   * Optional dedicated art for the mirror orientation (texture key). When loaded it replaces the
   * automatic flipX mirror without changing any logic — the piece stays ONE object.
   */
  mirrorSprite?: string;
  /** Base vertex (2x art px) of `mirrorSprite`; default = mirrored `baseVertex`. */
  mirrorBaseVertex?: [number, number];
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
