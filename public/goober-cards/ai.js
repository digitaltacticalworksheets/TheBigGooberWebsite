// Goober Cards computer opponent: one-ply greedy search.
// It simulates every legal action, scores the resulting table, and takes the
// best one until ending the turn looks best.
import { applyAction, legalActions } from "./engine.js";

export const AI_LEVELS = {
  pup: { name: "Pup", blurb: "Still learning the rules. Gentle.", noise: 6, blunder: 0.25, reward: 40 },
  goodboy: { name: "Good Boy", blurb: "Plays smart trades and pushes face.", noise: 1.2, blunder: 0.04, reward: 60 },
  biggoober: { name: "Big Goober", blurb: "Ruthless. Brings a spicy deck.", noise: 0, blunder: 0, reward: 90 }
};

const KW_VALUE = { guard: 1.2, fluffy: 1.6, lifesnack: 1, doubleWag: 0, bitey: 2.2, sneaky: 0.8, zoomies: 0 };

function minionValue(m) {
  let v = 1 + m.attack * 1.1 + m.health * 0.9;
  for (const kw of m.keywords || []) v += KW_VALUE[kw] || 0;
  if (m.keywords?.includes("doubleWag")) v += m.attack * 0.8;
  if (m.frozen) v -= m.attack * 0.4;
  return v;
}

function heroValue(hero) {
  const hp = hero.hp + hero.armor;
  // Each point of health matters more when you're close to losing.
  return hp <= 0 ? -1000 : hp * 0.9 + (hp < 8 ? (8 - hp) * -1.5 : 0);
}

export function evaluate(state, me) {
  if (state.over) return state.winner === me ? 100000 : state.winner === "draw" ? -500 : -100000;
  const foe = me === 0 ? 1 : 0;
  const a = state.players[me], b = state.players[foe];
  let score = 0;
  score += heroValue(a.hero) - heroValue(b.hero) * 1.15;
  score += a.board.reduce((s, m) => s + minionValue(m), 0);
  score -= b.board.reduce((s, m) => s + minionValue(m), 0) * 1.1;
  score += Math.min(a.hand.length, 8) * 0.7;
  score -= a.fatigue;
  // Threat: how much the enemy board could hit us for next turn with no guards in the way.
  const guards = a.board.some(m => m.keywords?.includes("guard"));
  const threat = b.board.reduce((s, m) => s + m.attack * (m.keywords?.includes("doubleWag") ? 2 : 1), 0);
  if (!guards && threat >= a.hero.hp + a.hero.armor) score -= 60;
  return score;
}

const clone = s => JSON.parse(JSON.stringify(s));

export function chooseAiAction(state, catalog, me, level = "goodboy", random = Math.random) {
  const cfg = AI_LEVELS[level] || AI_LEVELS.goodboy;
  const actions = legalActions(state, catalog, me);
  if (!actions.length) return { type: "end" };
  const nonEnd = actions.filter(a => a.type !== "end");
  if (!nonEnd.length) return { type: "end" };
  if (random() < cfg.blunder) {
    const pick = nonEnd[Math.floor(random() * nonEnd.length)];
    // Even a pup won't bonk its own face.
    if (!(pick.target === `h${me}` && pick.type !== "play")) return pick;
  }

  // Ending the turn is scored after the opponent's minions get to swing at us.
  const base = evaluate(state, me);
  let best = { type: "end" }, bestScore = base + 0.25;
  for (const action of nonEnd) {
    const sim = clone(state);
    const res = applyAction(sim, catalog, me, action);
    if (!res.ok) continue;
    let score = evaluate(sim, me) + (cfg.noise ? (random() - 0.5) * cfg.noise : 0);
    // Tiny nudge to spend mana: unused Bones are wasted.
    if (action.type === "play") score += (catalog[state.players[me].hand.find(c => c.uid === action.uid)?.id]?.cost || 0) * 0.15;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return best;
}
