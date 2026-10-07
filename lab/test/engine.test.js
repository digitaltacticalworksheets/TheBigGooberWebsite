// Run: node --test lab/test/
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame, applyAction, legalActions, vastMovesFrom, hasLegalAction, score, scoreWinner, randomAction,
  CELLS, CELL_COUNT, NEIGHBORS, STEP, cellAt, GOLD, PURPLE, MAX_STACK, TOTAL_DISKS, MAX_PLIES
} from "../engine.js";

const C = cellAt(0, 0);
const E = 0; // direction east: (q+1, r)

// Build a position directly: cells = { index: [height, owner] }.
function position(cells, extra = {}) {
  const s = createGame();
  let used = 0;
  for (const [i, [h, o]] of Object.entries(cells)) { s.h[+i] = h; s.o[+i] = o; used += h; }
  s.supply = TOTAL_DISKS - used;
  s.turns = [1, 1];
  s.ply = 2;
  return Object.assign(s, extra);
}
const act = (s, p, a) => {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.error);
  return r;
};
const fail = (s, p, a, re) => {
  const r = applyAction(s, p, a);
  assert.equal(r.ok, false);
  if (re) assert.match(r.error, re);
};
const east = (c, n = 1) => { for (let i = 0; i < n; i++) c = STEP[c][E]; return c; };

test("board has 61 cells in 4 rings around the centre", () => {
  assert.equal(CELL_COUNT, 61);
  const rings = [0, 0, 0, 0, 0];
  for (const c of CELLS) rings[c.ring]++;
  assert.deepEqual(rings, [1, 6, 12, 18, 24]);
  assert.equal(NEIGHBORS[C].length, 6);
  assert.equal(NEIGHBORS[cellAt(4, -4)].length, 3);
});

test("new game: empty board, full supply, gold to move", () => {
  const s = createGame();
  assert.equal(s.supply, 60);
  assert.equal(s.toMove, GOLD);
  assert.ok(s.h.every(h => h === 0));
  assert.equal(legalActions(s).length, 61);
});

test("spawn places one of your pieces on an empty cell", () => {
  const { state } = act(createGame(), GOLD, { type: "spawn", cell: C });
  assert.equal(state.h[C], 1);
  assert.equal(state.o[C], GOLD);
  assert.equal(state.supply, 59);
  assert.equal(state.toMove, PURPLE);
  fail(state, PURPLE, { type: "spawn", cell: C }, /empty/);
});

test("you can't act out of turn", () => {
  fail(createGame(), PURPLE, { type: "spawn", cell: C }, /turn/);
});

test("grow adds to your own stack only, and never above 5", () => {
  const s = position({ [C]: [2, GOLD], [east(C)]: [1, PURPLE] });
  const { state } = act(s, GOLD, { type: "grow", cell: C });
  assert.equal(state.h[C], 3);
  assert.equal(state.supply, s.supply - 1);
  fail(s, GOLD, { type: "grow", cell: east(C) }, /own/);
  fail(s, GOLD, { type: "grow", cell: east(C, 2) }, /own/);
});

test("growing to exactly 5 ripples: stack returns to supply, neighbours flip", () => {
  const n = NEIGHBORS[C];
  const s = position({ [C]: [4, GOLD], [n[0]]: [2, PURPLE], [n[1]]: [1, GOLD], [n[2]]: [3, PURPLE] });
  const before = s.supply;
  const { state, events } = act(s, GOLD, { type: "grow", cell: C });
  assert.equal(state.h[C], 0);
  assert.equal(state.o[C], -1);
  assert.equal(state.supply, before - 1 + 5);
  assert.equal(state.o[n[0]], GOLD);
  assert.equal(state.h[n[0]], 2, "flips don't change height");
  assert.equal(state.o[n[2]], GOLD);
  assert.equal(state.o[n[1]], GOLD, "already yours stays yours");
  const ripple = events.find(e => e.t === "ripple");
  assert.deepEqual(ripple.flipped.sort(), [n[0], n[2]].sort());
});

test("a single piece can't Vast Move", () => {
  const s = position({ [C]: [1, GOLD], [east(C, 3)]: [1, PURPLE] });
  assert.equal(vastMovesFrom(s, C).length, 0);
  fail(s, GOLD, { type: "vast", from: C, dir: E, drops: [1] }, /single/);
});

test("vast move: a 2-stack can move 1 cell; the origin empties", () => {
  const s = position({ [C]: [2, GOLD], [east(C, 4)]: [1, PURPLE] });
  const { state } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [2] });
  assert.equal(state.h[C], 0);
  assert.equal(state.o[C], -1);
  assert.equal(state.h[east(C)], 2);
  assert.equal(state.o[east(C)], GOLD);
  assert.equal(state.supply, s.supply, "vast move doesn't touch supply");
});

test("vast move drops at least one per cell, last cell takes the rest", () => {
  const s = position({ [C]: [4, GOLD], [east(C, 4)]: [1, PURPLE] });
  const { state } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [1, 3] });
  assert.equal(state.h[east(C)], 1);
  assert.equal(state.h[east(C, 2)], 3);
  fail(s, GOLD, { type: "vast", from: C, dir: E, drops: [2, 0, 2] }, /at least one/);
  fail(s, GOLD, { type: "vast", from: C, dir: E, drops: [1, 2] }, /Every piece/);
});

test("dropping onto an enemy stack converts the whole stack", () => {
  const s = position({ [C]: [3, GOLD], [east(C)]: [2, PURPLE] });
  const { state } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [1, 2] });
  assert.equal(state.h[east(C)], 3);
  assert.equal(state.o[east(C)], GOLD);
});

test("vast move can't push any cell above 5 or run off the board", () => {
  const s = position({ [C]: [3, GOLD], [east(C)]: [4, PURPLE], [cellAt(4, 0)]: [3, GOLD] });
  fail(s, GOLD, { type: "vast", from: C, dir: E, drops: [2, 1] }, /above 5/);
  fail(s, GOLD, { type: "vast", from: cellAt(4, 0), dir: E, drops: [3] }, /off the board/);
  for (const m of vastMovesFrom(s, C)) {
    if (m.dir === E) assert.equal(m.drops[0], 1, "only 1 fits on the 4-stack");
  }
});

test("vast move that makes a 5 ripples immediately", () => {
  const s = position({ [C]: [2, GOLD], [east(C)]: [3, PURPLE], [STEP[east(C)][1]]: [1, PURPLE] });
  const { state, events } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [2] });
  assert.equal(state.h[east(C)], 0, "the 5-stack is removed");
  assert.equal(state.o[STEP[east(C)][1]], GOLD, "its neighbour flipped");
  assert.ok(events.some(e => e.t === "ripple"));
});

test("one vast move can make two ripples", () => {
  const a = east(C), b = east(C, 2);
  const s = position({ [C]: [4, GOLD], [a]: [3, PURPLE], [b]: [3, PURPLE], [cellAt(-4, 0)]: [1, PURPLE] });
  const { state, events } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [2, 2] });
  assert.equal(events.filter(e => e.t === "ripple").length, 2);
  assert.equal(state.h[a], 0);
  assert.equal(state.h[b], 0);
  assert.equal(state.supply, s.supply + 10);
});

test("elimination doesn't fire before the opponent has had a turn", () => {
  const { state } = act(createGame(), GOLD, { type: "spawn", cell: C });
  assert.equal(state.over, false, "purple owns nothing yet but hasn't played");
});

test("elimination: a player who has played and owns nothing loses", () => {
  const n = NEIGHBORS[C];
  const s = position({ [C]: [4, GOLD], [n[0]]: [1, PURPLE], [n[3]]: [2, PURPLE] });
  const { state } = act(s, GOLD, { type: "grow", cell: C });
  assert.equal(state.over, true);
  assert.equal(state.winner, GOLD);
  assert.equal(state.reason, "elimination");
});

test("elimination of both players at once is a draw", () => {
  // Gold's only stack ripples; it touched no purple cell and purple owns nothing.
  const s = position({ [C]: [4, GOLD] });
  const { state } = act(s, GOLD, { type: "grow", cell: C });
  assert.equal(state.winner, "draw");
  assert.equal(state.reason, "elimination");
});

test("with supply left there is always a legal action", () => {
  const s = position({ [C]: [1, GOLD] });
  assert.ok(hasLegalAction(s, PURPLE));
});

test("no legal action with an empty supply loses", () => {
  // Purple owns only two single pieces and the supply is empty: Spawn and Grow need
  // supply, and singles can't move. Gold: a 2-stack in the centre plus fourteen 4-stacks.
  const cells = { [cellAt(-4, 0)]: [1, PURPLE], [cellAt(4, -4)]: [1, PURPLE], [C]: [2, GOLD] };
  const spare = CELLS.map((_, i) => i).filter(i => !cells[i] && i !== east(C) && CELLS[i].r > 0);
  for (const i of spare.slice(0, 14)) cells[i] = [4, GOLD];
  const s = position(cells, { toMove: GOLD });
  assert.equal(s.supply, 0);
  assert.equal(hasLegalAction(s, PURPLE), false);
  const { state } = act(s, GOLD, { type: "vast", from: C, dir: E, drops: [2] });
  assert.equal(state.over, true);
  assert.equal(state.reason, "stuck");
  assert.equal(state.winner, GOLD);
});

test("empty supply: spawn and grow are illegal, vast move still works", () => {
  const s = position({ [C]: [3, GOLD] }, { supply: 0 });
  fail(s, GOLD, { type: "spawn", cell: east(C, 2) }, /supply/);
  fail(s, GOLD, { type: "grow", cell: C }, /supply/);
  assert.ok(legalActions(s).every(a => a.type === "vast"));
  assert.ok(legalActions(s).length > 0);
});

test("score: most cells, then tallest stack, else draw", () => {
  assert.equal(scoreWinner(position({ 0: [1, GOLD], 1: [1, GOLD], 2: [5, PURPLE] })), GOLD);
  assert.equal(scoreWinner(position({ 0: [1, GOLD], 2: [3, PURPLE] })), PURPLE);
  assert.equal(scoreWinner(position({ 0: [2, GOLD], 2: [2, PURPLE] })), "draw");
  assert.deepEqual(score(position({ 0: [2, GOLD], 2: [3, PURPLE] })).cells, [1, 1]);
});

test("move limit decides by score", () => {
  const s = position({ [C]: [1, GOLD], [east(C, 2)]: [1, PURPLE], [east(C, 3)]: [1, PURPLE] }, { ply: MAX_PLIES - 1 });
  const { state } = act(s, GOLD, { type: "spawn", cell: cellAt(-4, 0) });
  assert.equal(state.over, true);
  assert.equal(state.reason, "limit");
  assert.equal(state.winner, "draw");
});

test("concede ends the game for the other player", () => {
  const { state } = act(createGame(), PURPLE, { type: "concede" });
  assert.equal(state.winner, GOLD);
  assert.equal(state.reason, "concede");
});

test("applyAction never mutates its input", () => {
  const s = position({ [C]: [4, GOLD], [east(C)]: [1, PURPLE] });
  const copy = JSON.stringify(s);
  act(s, GOLD, { type: "grow", cell: C });
  act(s, GOLD, { type: "vast", from: C, dir: E, drops: [1, 3] });
  assert.equal(JSON.stringify(s), copy);
});

test("every enumerated action is legal, and the piece count is conserved", () => {
  let s = createGame({ seed: 7 });
  for (let i = 0; i < 300 && !s.over; i++) {
    const all = legalActions(s);
    for (const a of all.slice(0, 40)) assert.ok(applyAction(s, s.toMove, a).ok);
    const r = act(s, s.toMove, randomAction(s));
    s = r.state;
    const onBoard = s.h.reduce((a, b) => a + b, 0);
    assert.equal(onBoard + s.supply, TOTAL_DISKS);
    assert.ok(s.h.every(h => h >= 0 && h <= MAX_STACK - 1 || h === 0));
    assert.ok(s.h.every((h, c) => (h === 0) === (s.o[c] === -1)));
  }
});

test("replay: the same actions always give the same game", () => {
  let s = createGame({ seed: 99 });
  const log = [];
  while (!s.over) { const a = randomAction(s); log.push([s.toMove, a]); s = act(s, s.toMove, a).state; }
  let t = createGame({ seed: 99 });
  for (const [p, a] of log) t = act(t, p, a).state;
  assert.deepEqual(t, s);
});

test("the browser's board geometry matches the engine", async () => {
  const web = await import("../web/board.js");
  const g = web.geometry(4);
  assert.deepEqual(g.cells, CELLS);
  assert.deepEqual(g.step, STEP);
  const from = cellAt(-2, 0);
  assert.deepEqual(web.pathOf(g, from, E, 3), [STEP[from][E], STEP[STEP[from][E]][E], STEP[STEP[STEP[from][E]][E]][E]]);
  assert.equal(g.names[0], "A1");
  assert.equal(g.names[cellAt(0, 0)], "E5");
});

test("large board: 91 cells, 90 pieces, longer move limit, same rules", async () => {
  const { geometry, plyLimit, BOARD_SIZES } = await import("../engine.js");
  const s = createGame({ radius: BOARD_SIZES.large });
  assert.equal(s.h.length, 91);
  assert.equal(s.supply, 90);
  assert.equal(s.total, 90);
  assert.equal(plyLimit(s), 600);
  assert.equal(plyLimit(createGame()), MAX_PLIES);
  const g = geometry(5);
  const rings = [0, 0, 0, 0, 0, 0];
  for (const c of g.cells) rings[c.ring]++;
  assert.deepEqual(rings, [1, 6, 12, 18, 24, 30]);
  let t = s;
  for (let i = 0; i < 400 && !t.over; i++) {
    t = act(t, t.toMove, randomAction(t)).state;
    assert.equal(t.h.reduce((a, b) => a + b, 0) + t.supply, 90);
  }
});

test("the browser's large-board geometry matches the engine", async () => {
  const web = await import("../web/board.js");
  const { geometry } = await import("../engine.js");
  for (const radius of [4, 5]) {
    assert.deepEqual(web.geometry(radius).cells, geometry(radius).cells);
    assert.deepEqual(web.geometry(radius).step, geometry(radius).step);
  }
});
