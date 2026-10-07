// NPC opponent: one-ply search over legalActions with a cheap evaluation.
// Deterministic for a given position (seeded noise), and fast enough to run inside
// the room's Durable Object on every NPC turn.
import { legalActions, applyAction, score, geo, MAX_STACK, rng, GOLD, PURPLE } from "./engine.js";

const other = p => (p === GOLD ? PURPLE : GOLD);

// Cells of `victim` that `attacker` could flip next turn by growing a 4-stack to 5.
function rippleThreat(s, attacker, victim) {
  if (s.supply < 1) return 0;
  let threat = 0;
  const NEIGHBORS = geo(s).neighbors;
  for (let c = 0; c < s.h.length; c++) {
    if (s.o[c] !== attacker || s.h[c] !== MAX_STACK - 1) continue;
    for (const n of NEIGHBORS[c]) if (s.o[n] === victim) threat += 1;
  }
  return threat;
}

// Stacks that could make at least a one-cell Vast Move. Once the supply is gone these
// are the only way to keep moving, and a player with no legal move loses.
function movableStacks(s, p) {
  let n = 0;
  const STEP = geo(s).step;
  for (let c = 0; c < s.h.length; c++) {
    if (s.o[c] !== p || s.h[c] < 2) continue;
    if (STEP[c].some(t => t >= 0 && s.h[t] + 1 <= MAX_STACK)) n += 1;
  }
  return n;
}

export function evaluate(s, me) {
  const them = other(me);
  if (s.over) return s.winner === me ? 1e6 : s.winner === "draw" ? -1e3 : -1e6;
  const { cells, pieces } = score(s);
  let v = 12 * (cells[me] - cells[them]) + 1.5 * (pieces[me] - pieces[them]);
  // Blocking: don't leave the opponent an easy ripple, and keep our own threats alive.
  v -= 9 * rippleThreat(s, them, me);
  v += 3 * rippleThreat(s, me, them);
  // Mobility matters more as the supply runs low.
  const scarcity = Math.max(0, 24 - s.supply);
  v += scarcity * (Math.min(4, movableStacks(s, me)) - 0.6 * Math.min(4, movableStacks(s, them)));
  if (s.supply === 0 && movableStacks(s, me) === 0) v -= 400;
  return v;
}

// Difficulty levels. depth 1 is a greedy one-move look; deeper levels search the
// opponent's replies (and our answer to them), keeping only the most promising
// `widths[i]` moves at each searched ply so a turn stays fast inside the room.
export const LEVELS = {
  easy: { depth: 1, noise: 40, blunder: 0.25 },
  normal: { depth: 1, noise: 2 },
  hard: { depth: 2, widths: [16], noise: 1 },
  expert: { depth: 3, widths: [12, 6], noise: 0.5 }
};
export const DEFAULT_LEVEL = "normal";

function children(s) {
  const out = [];
  for (const a of legalActions(s, s.toMove)) {
    const r = applyAction(s, s.toMove, a);
    if (r.ok) out.push({ a, s: r.state, ripple: r.events.some(e => e.t === "ripple") });
  }
  return out;
}

// Minimax value of `s` for `me`, looking `depth` more moves ahead.
function search(s, me, depth, widths, ply) {
  if (s.over || depth === 0) return evaluate(s, me);
  const kids = children(s);
  if (!kids.length) return evaluate(s, me);
  const maximize = s.toMove === me;
  let pool = kids;
  if (depth > 1) {
    // Each side considers the moves that look best to itself.
    const mover = s.toMove;
    pool = kids.map(k => ({ ...k, v: evaluate(k.s, mover) })).sort((x, y) => y.v - x.v).slice(0, widths[ply] || 8);
  }
  let best = maximize ? -Infinity : Infinity;
  for (const k of pool) {
    const v = search(k.s, me, depth - 1, widths, ply + 1);
    if (maximize ? v > best : v < best) best = v;
  }
  return best;
}

export function chooseAction(s, player = s.toMove, { depth = 1, widths = [], noise = 2, blunder = 0 } = {}) {
  if (s.over || player !== s.toMove) return null;
  const random = rng(s.seed ^ (s.ply * 2654435761));
  const kids = children(s);
  if (!kids.length) return null;
  if (blunder && random() < blunder) return kids[Math.floor(random() * kids.length)].a;
  let pool = kids.map(k => ({ ...k, v: evaluate(k.s, player) + (k.ripple ? 4 : 0) }));
  if (depth > 1) {
    pool.sort((x, y) => y.v - x.v);
    // A move that wins outright needs no further thought.
    if (pool[0].s.over && pool[0].s.winner === player) return pool[0].a;
    pool = pool.slice(0, widths[0] || 12).map(k => ({ ...k, v: search(k.s, player, depth - 1, widths, 1) + (k.ripple ? 4 : 0) }));
  }
  let best = null, bestScore = -Infinity;
  for (const k of pool) {
    const v = k.v + random() * noise;
    if (v > bestScore) { bestScore = v; best = k.a; }
  }
  return best;
}
