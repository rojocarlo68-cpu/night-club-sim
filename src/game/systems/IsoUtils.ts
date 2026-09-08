export interface IsoConfig {
  tileWidth: number;
  tileHeight: number;
  originX: number;
  originY: number;
}

export function tileToScreen(
  col: number,
  row: number,
  cfg: IsoConfig
): { x: number; y: number } {
  const x = (col - row) * (cfg.tileWidth / 2) + cfg.originX;
  const y = (col + row) * (cfg.tileHeight / 2) + cfg.originY;
  return { x, y };
}

export function screenToTile(
  x: number,
  y: number,
  cfg: IsoConfig
): { col: number; row: number } {
  const lx = x - cfg.originX;
  const ly = y - cfg.originY;
  const col = Math.round((lx / (cfg.tileWidth / 2) + ly / (cfg.tileHeight / 2)) / 2);
  const row = Math.round((ly / (cfg.tileHeight / 2) - lx / (cfg.tileWidth / 2)) / 2);
  return { col, row };
}

/** Furniture / props: lower bias so characters at same tile draw on top. */
export const FURNITURE_DEPTH_BIAS = 3;
/** Characters: above furniture at the same iso tile. */
export const CHARACTER_DEPTH_BIAS = 12;

export function depthForTile(col: number, row: number, bias = 0): number {
  return (col + row) * 10 + bias;
}

/** Depth for a furniture footprint (uses front-most tile = highest col+row). */
export function depthForFurniture(
  tileCol: number,
  tileRow: number,
  footprint: [number, number],
  bias = FURNITURE_DEPTH_BIAS
): number {
  const frontCol = tileCol + Math.max(0, footprint[0] - 1);
  const frontRow = tileRow + Math.max(0, footprint[1] - 1);
  return depthForTile(frontCol, frontRow, bias);
}

export function depthForCharacter(col: number, row: number): number {
  return depthForTile(col, row, CHARACTER_DEPTH_BIAS);
}
