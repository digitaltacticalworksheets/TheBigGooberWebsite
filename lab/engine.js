// Rules engine. Pure and deterministic: the Worker runs it for every room, and the
// tests and simulator import it directly. It is never served to browsers.
//
// A stack is stored as height + owner only. No rule ever exposes a piece below the
// top (stacks are only grown, dropped onto, picked up whole, or removed whole), so
// the colours further down never matter.

export const RADIUS = 4;
export const MAX_STACK = 5;
export const TOTAL_DISKS = 60;
export const GOLD = 0;
export const PURPLE = 1;
// After this many actions the game is decided by score, so a game always ends.
export const MAX_PLIES = 400;

// Axial directions, clockwise starting east.
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Cells in reading order: rows top (r = -4) to bottom, left to right.
export const CELLS = [];
const INDEX = new Map();
for (let r = -RADIUS; r <= RADIUS; r++) {
  for (let q = Math.max(-RADIUS, -r - RADIUS); q <= Math.min(RADIUS, -r + RADIUS); q++) {
    INDEX.set(`${q},${r}`, CELLS.length);
    CELLS.push({ q, r, ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) });
  }
}
export const CELL_COUNT = CELLS.length;
export const cellAt = (q, r) => INDEX.get(`${q},${r}`) ?? -1;
// STEP[cell][dir] = neighbouring cell index, or -1 off the board.
export const STEP = CELLS.map(({ q, r }) => DIRS.map(([dq, dr]) => cellAt(q + dq, r + dr)));
export const NEIGHBORS = STEP.map(list => list.filter(i => i >= 0));

const other = p => (p === GOLD ? PURPLE : GOLD);
const isCell = c => Number.isInteger(c) && c >= 0 && c < CELL_COUNT;

export function createGame({ seed = 1 } = {}) {
  return {
    v: 1,
    h: Array(CELL_COUNT).fill(0),
    o: Array(CELL_COUNT).fill(-1),
    supply: TOTAL_DISKS,
    toMove: GOLD,
    turns: [0, 0],
    ply: 0,
    seed: seed >>> 0,
    over: false,
    winner: null,
    reason: null
  };
}

function cloneState(s) {
  return { ...s, h: s.h.slice(), o: s.o.slice(), turns: s.turns.slice() };
}

export function score(s) {
  const cells = [0, 0], tallest = [0, 0], pieces = [0, 0];
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = s.o[i];
    if (p < 0) continue;
    cells[p] += 1;
    pieces[p] += s.h[i];
    if (s.h[i] > tallest[p]) tallest[p] = s.h[i];
  }
  return { cells, tallest, pieces };
}

// Winner by score: most cells, then tallest single stack, else a draw.
export function scoreWinner(s) {
  const { cells, tallest } = score(s);
  if (cells[0] !== cells[1]) return cells[0] > cells[1] ? GOLD : PURPLE;
  if (tallest[0] !== tallest[1]) return tallest[0] > tallest[1] ? GOLD : PURPLE;
  return "draw";
}

// --- Vast Move enumeration ----------------------------------------------------
// Every way to spread `height` pieces along direction `dir` from `from`: at least one
// piece per cell, the last cell takes the rest, and no cell may go above MAX_STACK.
function forEachVast(s, from, dir, visit) {
  const height = s.h[from];
  const path = [], caps = [];
  let c = from;
  while (path.length < height) {
    c = STEP[c][dir];
    if (c < 0) break;
    path.push(c);
    caps.push(MAX_STACK - s.h[c]);
  }
  const drops = [];
  const walk = (i, left) => {
    if (left === 0) { visit(path.slice(0, i), drops.slice(0, i)); return true; }
    if (i >= path.length) return false;
    const most = Math.min(caps[i], left);
    for (let d = 1; d <= most; d++) {
      drops[i] = d;
      if (walk(i + 1, left - d) === "stop") return "stop";
    }
    return false;
  };
  walk(0, height);
}

export function vastMovesFrom(s, from, player = s.toMove) {
  const moves = [];
  if (!isCell(from) || s.o[from] !== player || s.h[from] < 2) return moves;
  for (let dir = 0; dir < 6; dir++) forEachVast(s, from, dir, (path, drops) => moves.push({ type: "vast", from, dir, drops }));
  return moves;
}

export function legalActions(s, player = s.toMove) {
  const out = [];
  if (s.over || player !== s.toMove) return out;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (s.supply > 0 && s.h[i] === 0) out.push({ type: "spawn", cell: i });
    if (s.o[i] !== player) continue;
    if (s.supply > 0 && s.h[i] < MAX_STACK) out.push({ type: "grow", cell: i });
    if (s.h[i] >= 2) for (const m of vastMovesFrom(s, i, player)) out.push(m);
  }
  return out;
}

export function hasLegalAction(s, player) {
  // With supply left there is always an empty cell (at most 59 pieces on 61 cells).
  if (s.supply > 0) return true;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (s.o[i] !== player || s.h[i] < 2) continue;
    for (let dir = 0; dir < 6; dir++) {
      let found = false;
      forEachVast(s, i, dir, () => { found = true; });
      if (found) return true;
    }
  }
  return false;
}

// Path cells for a Vast Move, or an error string.
function vastPath(s, player, a) {
  if (!isCell(a.from)) return "Pick a stack.";
  if (s.o[a.from] !== player) return "You can only move a stack you own.";
  const height = s.h[a.from];
  if (height < 2) return "A single piece can't Vast Move.";
  if (!Number.isInteger(a.dir) || a.dir < 0 || a.dir > 5) return "Pick a direction.";
  const drops = a.drops;
  if (!Array.isArray(drops) || drops.length < 1 || drops.length > height) return "Invalid drops.";
  let sum = 0;
  for (const d of drops) {
    if (!Number.isInteger(d) || d < 1) return "Drop at least one piece on each cell.";
    sum += d;
  }
  if (sum !== height) return "Every piece in the stack has to be dropped.";
  const path = [];
  let c = a.from;
  for (let i = 0; i < drops.length; i++) {
    c = STEP[c][a.dir];
    if (c < 0) return "That runs off the board.";
    if (s.h[c] + drops[i] > MAX_STACK) return `No stack can go above ${MAX_STACK}.`;
    path.push(c);
  }
  return path;
}

function resolveRipples(s, player, touched, events) {
  for (const cell of touched) {
    if (s.h[cell] !== MAX_STACK) continue;
    s.h[cell] = 0;
    s.o[cell] = -1;
    s.supply += MAX_STACK;
    const flipped = [];
    for (const n of NEIGHBORS[cell]) {
      if (s.h[n] > 0 && s.o[n] !== player) { s.o[n] = player; flipped.push(n); }
    }
    events.push({ t: "ripple", cell, player, flipped });
  }
}

function finish(s, winner, reason, events) {
  s.over = true;
  s.winner = winner;
  s.reason = reason;
  events.push({ t: "end", winner, reason });
}

// Check the end conditions after `player` has acted. Order matters (see rules).
function checkEnd(s, player, events) {
  const { cells } = score(s);
  const out = [GOLD, PURPLE].filter(p => s.turns[p] > 0 && cells[p] === 0);
  if (out.length === 2) return finish(s, "draw", "elimination", events);
  if (out.length === 1) return finish(s, other(out[0]), "elimination", events);
  if (!hasLegalAction(s, s.toMove)) return finish(s, other(s.toMove), "stuck", events);
  if (s.ply >= MAX_PLIES) return finish(s, scoreWinner(s), "limit", events);
}

// action: { type: "spawn", cell } | { type: "grow", cell } | { type: "vast", from, dir, drops }
//       | { type: "concede" }
export function applyAction(state, player, action) {
  if (!action || typeof action !== "object") return { ok: false, error: "Invalid action." };
  if (state.over) return { ok: false, error: "The game is over." };
  if (player !== GOLD && player !== PURPLE) return { ok: false, error: "Not a player." };
  if (action.type === "concede") {
    const s = cloneState(state), events = [];
    finish(s, other(player), "concede", events);
    return { ok: true, state: s, events };
  }
  if (player !== state.toMove) return { ok: false, error: "It's not your turn." };

  const s = cloneState(state), events = [];
  let touched;
  if (action.type === "spawn") {
    const c = action.cell;
    if (s.supply < 1) return { ok: false, error: "The supply is empty." };
    if (!isCell(c) || s.h[c] !== 0) return { ok: false, error: "Spawn goes on an empty cell." };
    s.h[c] = 1;
    s.o[c] = player;
    s.supply -= 1;
    touched = [c];
    events.push({ t: "spawn", cell: c, player });
  } else if (action.type === "grow") {
    const c = action.cell;
    if (s.supply < 1) return { ok: false, error: "The supply is empty." };
    if (!isCell(c) || s.o[c] !== player) return { ok: false, error: "Grow goes on a stack you own." };
    if (s.h[c] >= MAX_STACK) return { ok: false, error: `No stack can go above ${MAX_STACK}.` };
    s.h[c] += 1;
    s.supply -= 1;
    touched = [c];
    events.push({ t: "grow", cell: c, player, height: s.h[c] });
  } else if (action.type === "vast") {
    const path = vastPath(s, player, action);
    if (typeof path === "string") return { ok: false, error: path };
    s.h[action.from] = 0;
    s.o[action.from] = -1;
    path.forEach((c, i) => { s.h[c] += action.drops[i]; s.o[c] = player; });
    touched = path;
    events.push({ t: "vast", from: action.from, dir: action.dir, path, drops: action.drops.slice(), player });
  } else {
    return { ok: false, error: "Unknown action." };
  }

  resolveRipples(s, player, touched, events);
  s.turns[player] += 1;
  s.ply += 1;
  s.toMove = other(player);
  checkEnd(s, player, events);
  return { ok: true, state: s, events };
}

// Small seeded PRNG for the NPC and for timed-out turns, so a position always gets
// the same choice (useful for replays and tests).
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// A random legal action: pick a kind of action first so the many Vast Move
// spreads don't drown out Spawn and Grow.
export function randomAction(s, random = rng(s.seed + s.ply * 7919)) {
  const all = legalActions(s);
  if (!all.length) return null;
  const kinds = [...new Set(all.map(a => a.type))];
  const kind = kinds[Math.floor(random() * kinds.length)];
  const pool = all.filter(a => a.type === kind);
  return pool[Math.floor(random() * pool.length)];
}
