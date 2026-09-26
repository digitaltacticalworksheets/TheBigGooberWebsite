// Achievement trophies, computed from the saved profile (so nothing extra has to be tracked
// or trusted). Most have Bronze/Silver/Gold goals; one-goal trophies go straight to Gold.
import { RANK_TIERS } from "./economy.js";

export const TIER_NAMES = ["Locked", "Bronze", "Silver", "Gold"];
export const TIER_MEDALS = ["🔒", "🥉", "🥈", "🥇"];

const owned = p => Object.entries(p.cards || {}).filter(([, c]) => (c?.n || 0) > 0).map(([id]) => id);

export const TROPHIES = [
  { id: "wins", icon: "🏆", name: "Certified Winner", goal: n => `Win ${n} game${n === 1 ? "" : "s"}`, goals: [1, 25, 100], value: p => p.stats.wins },
  { id: "streak", icon: "🔥", name: "On Fire", goal: n => `Win ${n} games in a row`, goals: [3, 5, 10], value: p => p.stats.bestStreak },
  { id: "boss", icon: "💀", name: "Final Boss Slayer", goal: n => `Beat the Final Boss ${n === 1 ? "once" : `${n} times`}`, goals: [1, 5, 25], value: p => p.stats.bossWins },
  { id: "online", icon: "🌐", name: "Online Menace", goal: n => `Win ${n} online match${n === 1 ? "" : "es"}`, goals: [1, 10, 50], value: p => p.stats.onlineWins },
  { id: "climber", icon: "🥖", name: "Bread Climber", goal: n => `Reach ${RANK_TIERS[n].icon} ${RANK_TIERS[n].name} in ranked`, goals: [1, 3, 5], value: p => RANK_TIERS.filter(t => (p.rank?.best || 0) >= t.min).length - 1 },
  { id: "veteran", icon: "⏳", name: "Touch Grass Later", goal: n => `Play ${n} games`, goals: [10, 100, 500], value: p => p.stats.wins + p.stats.losses },
  { id: "packs", icon: "🎁", name: "Pack Ripper", goal: n => `Open ${n} packs`, goals: [5, 50, 200], value: p => p.stats.packsOpened },
  { id: "shiny", icon: "✨", name: "Shiny Hunter", goal: n => `Pull ${n} shin${n === 1 ? "y" : "ies"}`, goals: [1, 10, 50], value: p => p.stats.shinies },
  { id: "collector", icon: "📚", name: "Collector", goal: n => `Own ${n}% of all cards`, goals: [25, 50, 100], value: (p, catalog) => {
    const all = Object.values(catalog || {}).filter(c => !c.token).map(c => c.id);
    if (!all.length) return 0;
    const mine = new Set(owned(p));
    return Math.floor((all.filter(id => mine.has(id)).length / all.length) * 100);
  } },
  { id: "legends", icon: "👑", name: "Legend Haver", goal: n => `Own ${n} different Legendar${n === 1 ? "y" : "ies"}`, goals: [1, 5, 15], value: (p, catalog) => owned(p).filter(id => catalog?.[id]?.rarity === "legendary").length },
  { id: "artist", icon: "✏️", name: "Certified Artist", goal: n => `Upload ${n} Goober${n === 1 ? "" : "s"}`, goals: [1, 5, 20], value: p => p.creations.length },
  { id: "squad", icon: "👥", name: "Squad Up", goal: n => `Have ${n} friend${n === 1 ? "" : "s"}`, goals: [1, 5, 20], value: p => p.friends.length },
  { id: "decks", icon: "🃏", name: "Deck Architect", goal: n => `Build ${n} deck${n === 1 ? "" : "s"}`, goals: [1, 3, 6], value: p => p.decks.length },
  { id: "homework", icon: "🎓", name: "Did the Homework", goal: () => "Finish the tutorial", goals: [1], value: p => (p.tutorialDone ? 1 : 0) }
];

// Tier 0-3 for a trophy. One-goal trophies jump from 0 to 3.
function tierFor(trophy, value) {
  const reached = trophy.goals.filter(g => value >= g).length;
  return trophy.goals.length === 1 ? (reached ? 3 : 0) : reached;
}

export function trophyProgress(p, catalog) {
  return TROPHIES.map(t => {
    const value = Math.max(0, Math.floor(Number(t.value(p, catalog)) || 0));
    const tier = tierFor(t, value);
    const nextGoal = t.goals.find(g => value < g) ?? null;
    return { ...t, value, tier, nextGoal, text: t.goal(nextGoal ?? t.goals[t.goals.length - 1]) };
  });
}

export function trophySummary(list) {
  const count = tier => list.filter(t => t.tier === tier).length;
  return { bronze: count(1), silver: count(2), gold: count(3), total: list.length, score: list.reduce((s, t) => s + t.tier, 0), max: list.length * 3 };
}

// Tiers reached since the player was last told. Updates `p.trophiesSeen`; returns the new ones.
export function newTrophyTiers(p, catalog) {
  const fresh = [];
  for (const t of trophyProgress(p, catalog)) {
    const seen = p.trophiesSeen[t.id] || 0;
    if (t.tier > seen) { fresh.push(t); p.trophiesSeen[t.id] = t.tier; }
  }
  return fresh;
}
