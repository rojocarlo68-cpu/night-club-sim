/**
 * Floor. Either one full-floor image (floor.json `image`, drawn directly by ClubScene) or, as below,
 * a tile-based floor.
 *
 * Tile-based floor. Data-driven by public/data/floor.json (grid of tile type ids + type list with
 * texture keys / files); the art for each type is a 2:1 diamond PNG (128x64 = one 64x32 tile at 2x).
 *
 * At startup every tile is stamped into ONE canvas texture (so there are no per-tile seams at any
 * zoom). Each tile is first re-masked to the exact pixel-centre diamond |cx|/hw + |cy|/hh < 1: that
 * rule partitions the plane exactly (a pixel centre can never lie on an edge), so neighbours never
 * overlap and never leave a gap, whatever the source art does at its edges (anti-aliased rim,
 * transparent fringe, other resolution). Holes inside the diamond are back-filled with the tile's
 * mean colour; art of any 2:1 size is resampled to the tile size.
 */
import Phaser from 'phaser';

export interface FloorTileType {
  id: string;
  texture: string;
  file: string;
}

export interface FloorData {
  tileWidth: number;
  tileHeight: number;
  /** Render scale of the baked floor (2 => 128x64 px per tile, displayed at 0.5). */
  textureScale: number;
  types: FloorTileType[];
  /** grid[row][col] = tile type id. */
  grid: string[][];
  /**
   * Single-image mode: ONE picture of the whole floor diamond (e.g. 1536x768 for 12x12 at textureScale 2).
   * When present the tile grid is not used / loaded; remove it to go back to tile mode.
   */
  image?: { texture: string; file: string };
}

export const FLOOR_TEXTURE_KEY = 'floor_composite';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Tile art -> exact diamond canvas (tw x th), hard edges, fully opaque inside. */
function bakeTile(img: CanvasImageSource, tw: number, th: number, fallback: string): HTMLCanvasElement {
  const tmp = makeCanvas(tw, th);
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(img, 0, 0, tw, th);
  const src = tctx.getImageData(0, 0, tw, th);
  const d = src.data;
  // Mean colour of the opaque pixels (back-fill for holes).
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 200) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
  }
  const mr = n ? r / n : 90, mg = n ? g / n : 80, mb = n ? b / n : 70;
  void fallback;
  const out = tctx.createImageData(tw, th);
  const o = out.data;
  const hw = tw / 2, hh = th / 2;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const cx = x + 0.5 - hw;
      const cy = y + 0.5 - hh;
      const i = (y * tw + x) * 4;
      if (Math.abs(cx) / hw + Math.abs(cy) / hh < 1) {
        const a = d[i + 3] / 255;
        o[i] = d[i] * a + mr * (1 - a);
        o[i + 1] = d[i + 1] * a + mg * (1 - a);
        o[i + 2] = d[i + 2] * a + mb * (1 - a);
        o[i + 3] = 255;
      } // else: transparent
    }
  }
  const res = makeCanvas(tw, th);
  res.getContext('2d')!.putImageData(out, 0, 0);
  return res;
}

/**
 * Builds the floor canvas texture. Tile (c, r) has its top vertex at
 * x = (c - r) * tw/2 + rows * tw/2,  y = (c + r) * th/2  (canvas px).
 * The caller positions the resulting image so canvas (rows*tw/2, 0) == top vertex of tile (0,0).
 */
export function buildFloorTexture(
  scene: Phaser.Scene,
  floor: FloorData,
  cols: number,
  rows: number
): { key: string; width: number; height: number; vertexX: number } {
  const S = floor.textureScale || 2;
  const tw = floor.tileWidth * S;
  const th = floor.tileHeight * S;
  const W = ((cols + rows) * tw) / 2;
  const H = ((cols + rows) * th) / 2;
  const vertexX = (rows * tw) / 2;

  const baked = new Map<string, HTMLCanvasElement>();
  const bakedFor = (id: string): HTMLCanvasElement => {
    let t = baked.get(id);
    if (t) return t;
    const type = floor.types.find((x) => x.id === id) ?? floor.types[0];
    const tex = scene.textures.get(type.texture);
    const img = tex.getSourceImage() as CanvasImageSource;
    t = bakeTile(img, tw, th, type.id);
    baked.set(id, t);
    return t;
  };

  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = floor.grid[r]?.[c] ?? floor.types[0].id;
      const x = (c - r) * (tw / 2) + vertexX - tw / 2; // top-left of the tile's bounding box
      const y = (c + r) * (th / 2);
      ctx.drawImage(bakedFor(id), x, y);
    }
  }

  if (scene.textures.exists(FLOOR_TEXTURE_KEY)) scene.textures.remove(FLOOR_TEXTURE_KEY);
  scene.textures.addCanvas(FLOOR_TEXTURE_KEY, canvas);
  return { key: FLOOR_TEXTURE_KEY, width: W, height: H, vertexX };
}
