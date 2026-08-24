// ---------------------------------------------------------------------------
// The Gearwood Thicket map: grid, single winding path, buildable tiles.
// This is the one MVP map; more regions/maps are a later phase.
// ---------------------------------------------------------------------------

export const GRID = {
  cols: 15,
  rows: 9,
  cell: 56,
};

// Waypoints in (col, row) grid space. Consecutive pairs must differ in only
// one axis so the path can be walked one cell at a time.
const PATH_WAYPOINTS: [number, number][] = [
  [-1, 4],
  [3, 4],
  [3, 1],
  [7, 1],
  [7, 7],
  [11, 7],
  [11, 2],
  [15, 2],
];

function buildPathCells(waypoints: [number, number][]): [number, number][] {
  const cells: [number, number][] = [[waypoints[0][0], waypoints[0][1]]];
  for (let i = 1; i < waypoints.length; i++) {
    let [cx, cy] = cells[cells.length - 1];
    const [tx, ty] = waypoints[i];
    while (cx !== tx || cy !== ty) {
      if (cx < tx) cx++;
      else if (cx > tx) cx--;
      else if (cy < ty) cy++;
      else if (cy > ty) cy--;
      cells.push([cx, cy]);
    }
  }
  return cells;
}

export const PATH_CELLS = buildPathCells(PATH_WAYPOINTS);
export const PATH_SET = new Set(PATH_CELLS.map(([c, r]) => `${c},${r}`));

export function cellToPixel(col: number, row: number) {
  return { x: col * GRID.cell + GRID.cell / 2, y: row * GRID.cell + GRID.cell / 2 };
}

export const PATH_POINTS = PATH_CELLS.map(([c, r]) => cellToPixel(c, r));

const PATH_DIST: number[] = [0];
for (let i = 1; i < PATH_POINTS.length; i++) {
  const a = PATH_POINTS[i - 1];
  const b = PATH_POINTS[i];
  PATH_DIST.push(PATH_DIST[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
}
export const PATH_LENGTH = PATH_DIST[PATH_DIST.length - 1];

export function pointAtDistance(dist: number): { x: number; y: number } {
  if (dist <= 0) return { ...PATH_POINTS[0] };
  if (dist >= PATH_LENGTH) return { ...PATH_POINTS[PATH_POINTS.length - 1] };
  let i = 1;
  while (i < PATH_DIST.length && PATH_DIST[i] < dist) i++;
  const d0 = PATH_DIST[i - 1];
  const d1 = PATH_DIST[i];
  const t = d1 === d0 ? 0 : (dist - d0) / (d1 - d0);
  const a = PATH_POINTS[i - 1];
  const b = PATH_POINTS[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function isBuildable(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return false;
  return !PATH_SET.has(`${col},${row}`);
}

export const MAP_WIDTH = GRID.cols * GRID.cell;
export const MAP_HEIGHT = GRID.rows * GRID.cell;
