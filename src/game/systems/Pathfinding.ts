export type GridPos = { col: number; row: number };

interface Node {
  col: number;
  row: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

function key(c: number, r: number): string {
  return `${c},${r}`;
}

export class Pathfinder {
  constructor(
    private cols: number,
    private rows: number,
    private blocked: Set<string>
  ) {}

  isWalkable(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    return !this.blocked.has(key(col, row));
  }

  setBlocked(col: number, row: number, blocked: boolean): void {
    const k = key(col, row);
    if (blocked) this.blocked.add(k);
    else this.blocked.delete(k);
  }

  findPath(start: GridPos, goal: GridPos): GridPos[] {
    if (!this.isWalkable(goal.col, goal.row)) {
      const alt = this.nearestWalkable(goal);
      if (!alt) return [];
      goal = alt;
    }
    if (start.col === goal.col && start.row === goal.row) return [start];

    const open: Node[] = [];
    const closed = new Set<string>();
    const startNode: Node = {
      col: start.col,
      row: start.row,
      g: 0,
      h: this.heuristic(start, goal),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.h;
    open.push(startNode);

    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;
      const ck = key(current.col, current.row);
      if (closed.has(ck)) continue;
      closed.add(ck);

      if (current.col === goal.col && current.row === goal.row) {
        return this.rebuild(current);
      }

      for (const [dc, dr] of dirs) {
        const nc = current.col + dc;
        const nr = current.row + dr;
        if (!this.isWalkable(nc, nr)) continue;
        if (closed.has(key(nc, nr))) continue;
        // no corner cutting
        if (dc !== 0 && dr !== 0) {
          if (!this.isWalkable(current.col + dc, current.row)) continue;
          if (!this.isWalkable(current.col, current.row + dr)) continue;
        }
        const g = current.g + (dc !== 0 && dr !== 0 ? 1.414 : 1);
        const h = this.heuristic({ col: nc, row: nr }, goal);
        open.push({ col: nc, row: nr, g, h, f: g + h, parent: current });
      }
    }
    return [];
  }

  private heuristic(a: GridPos, b: GridPos): number {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  }

  private rebuild(node: Node): GridPos[] {
    const path: GridPos[] = [];
    let n: Node | null = node;
    while (n) {
      path.push({ col: n.col, row: n.row });
      n = n.parent;
    }
    return path.reverse();
  }

  private nearestWalkable(goal: GridPos): GridPos | null {
    for (let r = 1; r <= 4; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          const c = goal.col + dc;
          const row = goal.row + dr;
          if (this.isWalkable(c, row)) return { col: c, row };
        }
      }
    }
    return null;
  }
}
