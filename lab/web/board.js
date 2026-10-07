// Board geometry for the browser. Must match lab/engine.js exactly (a test checks this).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const CACHE = new Map();
export function geometry(radius = 4) {
  if (CACHE.has(radius)) return CACHE.get(radius);
  const cells = [], index = new Map();
  for (let r = -radius; r <= radius; r++) {
    for (let q = Math.max(-radius, -r - radius); q <= Math.min(radius, -r + radius); q++) {
      index.set(`${q},${r}`, cells.length);
      cells.push({ q, r, ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) });
    }
  }
  const at = (q, r) => index.get(`${q},${r}`) ?? -1;
  const step = cells.map(({ q, r }) => DIRS.map(([dq, dr]) => at(q + dq, r + dr)));
  // Human-readable names: rows A, B, C… from the top, columns 1, 2, 3… from the left.
  const names = [];
  let row = -1, col = 0, lastR = null;
  for (const c of cells) {
    if (c.r !== lastR) { row += 1; col = 0; lastR = c.r; }
    col += 1;
    names.push(`${String.fromCharCode(65 + row)}${col}`);
  }
  const g = { radius, cells, count: cells.length, step, names };
  CACHE.set(radius, g);
  return g;
}

// Cells a Vast Move from `from` in `dir` passes through, one per drop.
export function pathOf(g, from, dir, length) {
  const path = [];
  let c = from;
  for (let i = 0; i < length; i++) { c = g.step[c][dir]; if (c < 0) break; path.push(c); }
  return path;
}
