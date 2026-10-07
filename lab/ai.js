// NPC opponent: one-ply search over legalActions with a cheap evaluation.
// Deterministic for a given position (seeded noise), and fast enough to run inside
// the room's Durable Object on every NPC turn.
import { legalActions, applyAction, score, NEIGHBORS, CELL_COUNT, MAX_STACK, STEP, rng, GOLD, PURPLE } from "./engine.js";

const other = p => (p === GOLD ? PURPLE : GOLD);

// Cells of `victim` that `attacker` could flip next turn by growing a 4-stack to 5.
function rippleThreat(s, attacker, victim) {
  if (s.supply < 1) return 0;
  let threat = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (s.o[c] !== attacker || s.h[c] !== MAX_STACK - 1) continue;
    for (const n of NEIGHBORS[c]) if (s.o[n] === victim) threat += 1;
  }
  return threat;
}

// Stacks that could make at least a one-cell Vast Move. Once the supply is gone these
// are the only way to keep moving, and a player with no legal move loses.
function movableStacks(s, p) {
  let n = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
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

export function chooseAction(s, player = s.toMove, { noise = 2 } = {}) {
  const actions = legalActions(s, player);
  if (!actions.length) return null;
  const random = rng(s.seed ^ (s.ply * 2654435761));
  let best = null, bestScore = -Infinity;
  for (const a of actions) {
    const r = applyAction(s, player, a);
    if (!r.ok) continue;
    const v = evaluate(r.state, player) + (r.events.some(e => e.t === "ripple") ? 4 : 0) + random() * noise;
    if (v > bestScore) { bestScore = v; best = a; }
  }
  return best;
}
