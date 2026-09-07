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

export function depthForTile(col: number, row: number, bias = 0): number {
  return (col + row) * 10 + bias;
}
