/**
 * Exact 2:1 floor geometry. The 12x12 floor art (768x384, 64x32 tiles) is drawn 1:1 and its
 * diamond IS the tile grid, so placement is purely tile-integer (footprint vs. map bounds /
 * blocked tiles) — no sprite bounding boxes or neon-rim fudge factors.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Grid vertex of the floor art in image pixels (top vertex of tile (0,0)). Measured from the
 * 63 interior grid-line centroids of the 768x384 source (sub-pixel JPEG offset kept so the
 * art lies exactly on the grid).
 */
export const FLOOR_ART_VERTEX = { x: 384.39, y: 0.465 };

/** Floor art size in px (displayed 1:1, scale 1.0). */
export const FLOOR_ART_SIZE = { w: 768, h: 384 };

/**
 * Stage art (452x260): its base footprint (cyan line centrelines) corner at the *top* vertex
 * of the 12x2 footprint maps to this pixel; the sprite is drawn 1:1 with origin top-left.
 * Base quad in art px: left (1.44,226.54), bottom (65.44,258.54), right (449.44,66.54),
 * top (385.44,34.54).
 */
export const STAGE_ART_TOP_VERTEX = { x: 385.44, y: 34.54 };
