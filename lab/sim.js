// AI-vs-AI simulator. Run: node lab/sim.js [games] [mode] [board]
//   mode "npc" (default): NPC vs NPC.  mode "random": random vs random.  mode "mixed": NPC (gold) vs random.
//   mode "<level>:<level>" (e.g. "hard:normal"): pits two NPC levels, swapping colours each game.
//   board "standard" (default) or "large".
import { createGame, applyAction, randomAction, legalActions, BOARD_SIZES, MAX_STACK, GOLD, PURPLE } from "./engine.js";
import { chooseAction, LEVELS } from "./ai.js";

const games = Number(process.argv[2]) || 1000;
const mode = process.argv[3] || "npc";
const board = process.argv[4] || "standard";
const radius = BOARD_SIZES[board] || BOARD_SIZES.standard;
const duel = mode.includes(":") ? mode.split(":") : null;
if (duel && !duel.every(l => LEVELS[l])) throw new Error(`Levels: ${Object.keys(LEVELS).join(", ")}`);
let game = 0;
// In a duel, side A plays gold in even games and purple in odd ones.
const levelOf = p => duel[(p + game) % 2];
const pick = (s, p) => {
  if (mode === "random" || (mode === "mixed" && p === PURPLE)) return randomAction(s);
  return chooseAction(s, p, duel ? LEVELS[levelOf(p)] : undefined);
};
const sideWins = {};

const wins = { 0: 0, 1: 0, draw: 0 }, reasons = {};
let plies = 0, longest = 0, shortest = Infinity, errors = 0, npcMs = 0, npcCalls = 0, maxNpcMs = 0, maxActions = 0;
const started = Date.now();
const s0 = createGame({ radius });
for (let g = 0; g < games; g++) {
  game = g;
  let s = createGame({ seed: g * 7919 + 1, radius });
  while (!s.over) {
    maxActions = Math.max(maxActions, legalActions(s).length);
    const t0 = performance.now();
    const a = pick(s, s.toMove);
    const dt = performance.now() - t0;
    npcMs += dt; npcCalls++; maxNpcMs = Math.max(maxNpcMs, dt);
    const r = applyAction(s, s.toMove, a);
    if (!r.ok) { errors++; break; }
    s = r.state;
    const total = s.h.reduce((x, y) => x + y, 0) + s.supply;
    if (total !== s.total || s.h.some(h => h < 0 || h >= MAX_STACK) || s.h.some((h, c) => (h === 0) !== (s.o[c] === -1))) { errors++; break; }
  }
  wins[s.winner ?? "draw"]++;
  if (duel && s.winner !== "draw") sideWins[levelOf(s.winner)] = (sideWins[levelOf(s.winner)] || 0) + 1;
  reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  plies += s.ply; longest = Math.max(longest, s.ply); shortest = Math.min(shortest, s.ply);
}
const pct = n => `${((100 * n) / games).toFixed(1)}%`;
console.log(`Simulated ${games} games (${mode}, ${board} board: ${s0.h.length} cells, ${s0.total} pieces) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Gold (first) wins: ${wins[GOLD]} (${pct(wins[GOLD])})  Purple wins: ${wins[PURPLE]} (${pct(wins[PURPLE])})  Draws: ${wins.draw} (${pct(wins.draw)})`);
if (duel) console.log(`${duel[0]} wins: ${sideWins[duel[0]] || 0} (${pct(sideWins[duel[0]] || 0)})  ${duel[1]} wins: ${sideWins[duel[1]] || 0} (${pct(sideWins[duel[1]] || 0)})`);
console.log(`Game length (actions): avg ${(plies / games).toFixed(1)}, min ${shortest}, max ${longest}`);
console.log(`End reasons: ${Object.entries(reasons).map(([k, v]) => `${k} ${v} (${pct(v)})`).join(", ")}`);
console.log(`Move choice time: avg ${(npcMs / npcCalls).toFixed(2)}ms, max ${maxNpcMs.toFixed(1)}ms; most legal actions in a position: ${maxActions}`);
console.log(`Illegal-state errors: ${errors}`);
