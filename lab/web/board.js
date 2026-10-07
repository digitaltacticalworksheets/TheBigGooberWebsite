// Board geometry for the browser. Must match lab/engine.js exactly (a test checks this).
export const RADIUS = 4;
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const CELLS = [];
const INDEX = new Map();
for (let r = -RADIUS; r <= RADIUS; r++) {
  for (let q = Math.max(-RADIUS, -r - RADIUS); q <= Math.min(RADIUS, -r + RADIUS); q++) {
    INDEX.set(`${q},${r}`, CELLS.length);
    CELLS.push({ q, r, ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) });
  }
}
export const cellAt = (q, r) => INDEX.get(`${q},${r}`) ?? -1;
export const STEP = CELLS.map(({ q, r }) => DIRS.map(([dq, dr]) => cellAt(q + dq, r + dr)));

// Cells a Vast Move from `from` in `dir` passes through, one per drop.
export function pathOf(from, dir, length) {
  const path = [];
  let c = from;
  for (let i = 0; i < length; i++) { c = STEP[c][dir]; if (c < 0) break; path.push(c); }
  return path;
}
