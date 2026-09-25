// Goober Cards computer opponent: one-ply greedy search.
// It simulates every legal action, scores the resulting table, and takes the
// best one until ending the turn looks best.
import { applyAction, legalActions } from "./engine.js";

// Sleepy is the gentle one for new players: besides random moves it often dozes off
// (ends its turn with cards and Aura left), passes on attacks, and never BARK FARTs.
export const AI_LEVELS = {
  sleepy: { name: "Sleepy Goober", blurb: "Mostly napping. Forgets to attack. Perfect for learning.", noise: 10, blunder: 0.55, doze: 0.3, skipAttack: 0.5, noPower: true, reward: 25 },
  pup: { name: "NPC", blurb: "Knows the rules. Makes some goofy plays.", noise: 6, blunder: 0.25, reward: 40 },
  goodboy: { name: "Tryhard", blurb: "Actually reads the cards. Kind of sweaty.", noise: 1.2, blunder: 0.04, reward: 60 },
  // Final Boss also starts ahead: one extra card and 4 Drip (about 60/40 against Tryhard).
  biggoober: { name: "Final Boss", blurb: "No mercy. Stacked deck. Starts with an extra card and 4 Drip.", noise: 0, blunder: 0, startCards: 1, startArmor: 4, reward: 90 }
};

const KW_VALUE = { guard: 1.2, fluffy: 1.6, lifesnack: 1, doubleWag: 0, bitey: 2.2, sneaky: 0.8, zoomies: 0, leftOnRead: 1, tough: 1.5 };

// Last Words and end-of-turn abilities are still to come, so they're worth something (until Shadowbanned).
const LINGERING = new Set(["lastBark", "endTurn"]);

function minionValue(m, catalog) {
  let v = 1 + m.attack * 1.1 + m.health * 0.9;
  for (const kw of m.keywords || []) v += KW_VALUE[kw] || 0;
  if (m.keywords?.includes("doubleWag")) v += m.attack * 0.8;
  if (m.frozen) v -= m.attack * 0.4;
  if (!m.silenced && LINGERING.has(catalog?.[m.id]?.ability?.trigger)) v += 1.5;
  return v;
}

function heroValue(hero) {
  const hp = hero.hp + hero.armor;
  // Each point of health matters more when you're close to losing.
  return hp <= 0 ? -1000 : hp * 0.9 + (hp < 8 ? (8 - hp) * -1.5 : 0);
}

export function evaluate(state, me, catalog = null) {
  if (state.over) return state.winner === me ? 100000 : state.winner === "draw" ? -500 : -100000;
  const foe = me === 0 ? 1 : 0;
  const a = state.players[me], b = state.players[foe];
  let score = 0;
  score += heroValue(a.hero) - heroValue(b.hero) * 1.15;
  score += a.board.reduce((s, m) => s + minionValue(m, catalog), 0);
  score -= b.board.reduce((s, m) => s + minionValue(m, catalog), 0) * 1.1;
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
  const self = state.players[me];
  if (!self.mulliganDone && state.active === me) {
    // Throw back pricey cards from the opening hand.
    const uids = self.hand.filter(c => (catalog[c.id]?.cost ?? 0) >= 4).map(c => c.uid).slice(0, 4);
    return { type: "mulligan", uids };
  }
  const actions = legalActions(state, catalog, me);
  if (!actions.length) return { type: "end" };
  let nonEnd = actions.filter(a => a.type !== "end");
  if (cfg.noPower) nonEnd = nonEnd.filter(a => a.type !== "power");
  if (cfg.skipAttack && random() < cfg.skipAttack) nonEnd = nonEnd.filter(a => a.type !== "attack");
  if (!nonEnd.length) return { type: "end" };
  if (cfg.doze && random() < cfg.doze) return { type: "end" };
  if (random() < cfg.blunder) {
    const pick = nonEnd[Math.floor(random() * nonEnd.length)];
    // Even a pup won't bonk its own face.
    if (!(pick.target === `h${me}` && pick.type !== "play")) return pick;
  }

  // Ending the turn is scored after the opponent's minions get to swing at us.
  const base = evaluate(state, me, catalog);
  let best = { type: "end" }, bestScore = base + 0.25;
  for (const action of nonEnd) {
    const sim = clone(state);
    const res = applyAction(sim, catalog, me, action);
    if (!res.ok) continue;
    let score = evaluate(sim, me, catalog) + (cfg.noise ? (random() - 0.5) * cfg.noise : 0);
    // Tiny nudge to spend mana: unused Bones are wasted.
    if (action.type === "play") score += (catalog[state.players[me].hand.find(c => c.uid === action.uid)?.id]?.cost || 0) * 0.15;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return best;
}
