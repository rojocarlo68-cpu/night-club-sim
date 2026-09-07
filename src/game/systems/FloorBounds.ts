/**
 * Playable floor polygon + furniture visual-footprint placement checks.
 * Reusable for every purchasable decoration — not sofa/bar-specific.
 */

export interface Point {
  x: number;
  y: number;
}

export interface OpaqueBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  texW: number;
  texH: number;
}

/** Matches ClubScene.drawRoom: tile-center diamond = roomDisplay * this frac. */
export const ROOM_NEON_MATCH_FRAC = 0.84;

/** Neon rim bbox as a fraction of the room art image (approx.). */
export const ROOM_NEON_ART_FRAC = 0.87;

/** Inset from neon rim toward center (4–8%) so sprites sit flush inside glossy floor. */
export const FLOOR_INSET = 0.04;

/**
 * Fraction of opaque height (from the bottom) treated as the floor-contact footprint.
 * Upper “air” pixels of upright iso furniture are ignored so tall sprites are not
 * rejected solely because their tops sit outside the floor diamond in screen space.
 */
export const FLOOR_CONTACT_FRAC = 0.45;

const ALPHA_THRESH = 12;

const opaqueCache = new Map<string, OpaqueBounds>();

/**
 * Iso diamond matching the glossy floor inside the neon rim.
 * Derived from room art display size: neon ≈ art * ROOM_NEON_ART_FRAC, then inset.
 */
export function computePlayableFloorPolygon(
  roomX: number,
  roomY: number,
  roomDisplayW: number,
  roomDisplayH: number,
  neonArtFrac = ROOM_NEON_ART_FRAC,
  inset = FLOOR_INSET
): Point[] {
  const halfW = (roomDisplayW * neonArtFrac * (1 - inset)) / 2;
  const halfH = (roomDisplayH * neonArtFrac * (1 - inset)) / 2;
  return [
    { x: roomX, y: roomY - halfH }, // top
    { x: roomX + halfW, y: roomY }, // right
    { x: roomX, y: roomY + halfH }, // bottom
    { x: roomX - halfW, y: roomY }, // left
  ];
}

/** Ray-casting point-in-polygon (works for convex iso diamond). */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const denom = yj - yi || 1e-9;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Sample opaque-pixel AABB of a Phaser texture frame (cached per key).
 * Falls back to full frame if no opaque pixels found.
 */
export function getOpaqueBounds(
  textures: { exists: (k: string) => boolean; get: (k: string) => Phaser.Textures.Texture },
  key: string
): OpaqueBounds {
  const hit = opaqueCache.get(key);
  if (hit) return hit;

  if (!textures.exists(key)) {
    const fallback: OpaqueBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1, texW: 1, texH: 1 };
    opaqueCache.set(key, fallback);
    return fallback;
  }

  const tex = textures.get(key);
  const frame = tex.get();
  const texW = Math.max(1, frame.cutWidth || frame.width);
  const texH = Math.max(1, frame.cutHeight || frame.height);
  const src = tex.getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;

  let minX = texW;
  let minY = texH;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  try {
    if (src && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = texW;
      canvas.height = texH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const cutX = frame.cutX || 0;
        const cutY = frame.cutY || 0;
        ctx.drawImage(src as CanvasImageSource, cutX, cutY, texW, texH, 0, 0, texW, texH);
        const data = ctx.getImageData(0, 0, texW, texH).data;
        const step = texW * texH > 180_000 ? 2 : 1;
        for (let y = 0; y < texH; y += step) {
          for (let x = 0; x < texW; x += step) {
            if (data[(y * texW + x) * 4 + 3] > ALPHA_THRESH) {
              found = true;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
    }
  } catch {
    found = false;
  }

  if (!found) {
    minX = 0;
    minY = 0;
    maxX = texW - 1;
    maxY = texH - 1;
  }

  const bounds: OpaqueBounds = { minX, minY, maxX, maxY, texW, texH };
  opaqueCache.set(key, bounds);
  return bounds;
}

/**
 * World-space corners of the floor-contact visual box (bottom of opaque AABB).
 * Optional padding shrinks the checked box further (scenario visualInset support).
 */
export function visualCorners(
  bounds: OpaqueBounds,
  worldX: number,
  worldY: number,
  displayW: number,
  displayH: number,
  originX = 0.5,
  originY = 0.5,
  contactFrac = FLOOR_CONTACT_FRAC,
  padX = 0,
  padY = 0
): Point[] {
  const sx = displayW / bounds.texW;
  const sy = displayH / bounds.texH;
  const opaqueLeft = worldX - originX * displayW + bounds.minX * sx;
  const opaqueRight = worldX - originX * displayW + (bounds.maxX + 1) * sx;
  const opaqueTop = worldY - originY * displayH + bounds.minY * sy;
  const opaqueBottom = worldY - originY * displayH + (bounds.maxY + 1) * sy;
  const h = opaqueBottom - opaqueTop;
  const contactTop = opaqueBottom - h * Math.min(1, Math.max(0.15, contactFrac));
  const left = opaqueLeft + padX;
  const right = opaqueRight - padX;
  const top = contactTop + padY;
  const bottom = opaqueBottom - padY;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * Authority check: furniture visual footprint stays inside the floor polygon.
 * Pass texture key (any future decoration) + intended world pose/size.
 */
export function canPlaceVisual(
  textures: { exists: (k: string) => boolean; get: (k: string) => Phaser.Textures.Texture },
  floorPoly: Point[],
  textureKey: string,
  worldX: number,
  worldY: number,
  displayW: number,
  displayH: number,
  padX = 0,
  padY = 0
): boolean {
  if (!floorPoly?.length) return true;
  const bounds = getOpaqueBounds(textures, textureKey);
  const corners = visualCorners(
    bounds,
    worldX,
    worldY,
    displayW,
    displayH,
    0.5,
    0.5,
    FLOOR_CONTACT_FRAC,
    padX,
    padY
  );
  for (const c of corners) {
    if (!pointInPolygon(c, floorPoly)) return false;
  }
  return true;
}

/** Clear opaque-bounds cache (tests / hot reload). */
export function clearOpaqueBoundsCache(): void {
  opaqueCache.clear();
}

/** Allow tests to inject precomputed opaque bounds without Phaser. */
export function setOpaqueBoundsForTests(key: string, bounds: OpaqueBounds): void {
  opaqueCache.set(key, bounds);
}
