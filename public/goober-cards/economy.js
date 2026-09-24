// Goober Cards economy rules: packs, coins, crafting, rewards.
// Pure functions on a profile object, shared by the browser (guest mode) and the
// worker (logged-in players, where the server is the source of truth).
import { MAX_COPIES, RARITIES } from "./cards.js";

export const PACKS = {
  goober: { id: "goober", name: "Goober Pack", price: 100, size: 5, blurb: "5 cards from the whole set. At least one Rare or better.", color: "#ffd34d", shinyChance: 0.06, onlyGoobers: false },
  gallery: { id: "gallery", name: "Gallery Pack", price: 150, size: 5, blurb: "Only uploaded Goobers. Better odds for shinies and Epics.", color: "#ff8bd1", shinyChance: 0.12, onlyGoobers: true, epicBoost: true }
};

export const RECYCLE_VALUE = { common: 5, rare: 20, epic: 60, legendary: 200 };
export const CRAFT_COST = { common: 40, rare: 100, epic: 300, legendary: 800 };
export const PITY_LIMIT = 10;
export const SOLO_REWARD = { pup: 40, goodboy: 60, biggoober: 90 };
export const ONLINE_REWARD = { win: 100, loss: 30 };
export const FIRST_WIN_BONUS = 50;
// Server-side limits on match rewards (per UTC day), so fake "wins" can't print coins.
export const DAILY_REWARD_CAP = { solo: 600, online: 1000 };
export const MIN_SOLO_MATCH_MS = 40 * 1000;

const STARTER = [
  ["treat-bonk", 2], ["treat-belly-rub", 2], ["treat-snack-time", 2], ["treat-zoomies", 2],
  ["treat-cozy-blanket", 2], ["treat-squeaky-toy", 2], ["cool-goober", 2], ["party-goober", 2], ["cowboy-goober", 1]
];

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function utcDay(date = new Date()) { return date.toISOString().slice(0, 10); }

export function freshProfile() {
  const cards = {};
  for (const [id, n] of STARTER) cards[id] = { n, s: 0 };
  return {
    v: 2,
    name: "",
    coins: 150,
    packs: { goober: 3, gallery: 0 },
    cards,
    newCards: {},
    decks: [],
    activeDeck: null,
    pity: 0,
    stats: { wins: 0, losses: 0, packsOpened: 0, shinies: 0, streak: 0 },
    lastDaily: "",
    lastWinDay: "",
    rewardDay: { day: "", solo: 0, online: 0 },
    openMatch: null,
    settings: { sound: true, haptics: true },
    tutorialSeen: false,
    created: Date.now()
  };
}

export function normalizeProfile(data) {
  const p = { ...freshProfile(), ...(data && typeof data === "object" ? data : {}) };
  p.settings = { sound: true, haptics: true, ...(p.settings || {}) };
  p.stats = { ...freshProfile().stats, ...(p.stats || {}) };
  p.packs = { goober: 0, gallery: 0, ...(p.packs || {}) };
  p.cards = p.cards && typeof p.cards === "object" ? p.cards : {};
  p.decks = Array.isArray(p.decks) ? p.decks : [];
  p.newCards = p.newCards && typeof p.newCards === "object" ? p.newCards : {};
  p.rewardDay = { day: "", solo: 0, online: 0, ...(p.rewardDay || {}) };
  p.coins = Math.max(0, Math.floor(Number(p.coins) || 0));
  p.pity = Math.max(0, Math.floor(Number(p.pity) || 0));
  return p;
}

export const ownedCount = (p, id) => p.cards[id]?.n || 0;

function addCard(p, id, shiny) {
  const entry = p.cards[id] || { n: 0, s: 0 };
  if (!entry.n) p.newCards[id] = true;
  entry.n += 1;
  if (shiny) { entry.s += 1; p.stats.shinies += 1; }
  p.cards[id] = entry;
}

// One free Goober Pack per day.
export function claimDaily(p, day) {
  if (p.lastDaily === day) return { ok: false, error: "Already claimed today." };
  p.lastDaily = day;
  p.packs.goober = (p.packs.goober || 0) + 1;
  return { ok: true, packs: 1 };
}

export function buyPack(p, type) {
  const def = PACKS[type];
  if (!def) return { ok: false, error: "Unknown pack." };
  if (p.coins < def.price) return { ok: false, error: `You need ${def.price - p.coins} more coins.` };
  p.coins -= def.price;
  p.packs[type] = (p.packs[type] || 0) + 1;
  return { ok: true };
}

function rollRarity(rng, guaranteeRare, def, forceLegendary) {
  if (forceLegendary) return "legendary";
  const r = rng() * 100;
  const epicOdds = def.epicBoost ? 12 : 7;
  if (r < 2.5) return "legendary";
  if (r < 2.5 + epicOdds) return "epic";
  if (r < 30 || guaranteeRare) return "rare";
  return "common";
}

// Open one pack. Returns { ok, cards: [{id, shiny, isNew, rarity}] }.
export function openPack(p, type, catalog, rng = Math.random) {
  const def = PACKS[type];
  if (!def || !(p.packs[type] > 0)) return { ok: false, error: "No packs of that kind to open." };
  const pool = {};
  for (const r of RARITIES) pool[r] = [];
  for (const card of Object.values(catalog)) {
    if (card.token) continue;
    if (def.onlyGoobers && card.type !== "minion") continue;
    pool[card.rarity].push(card.id);
  }
  if (!RARITIES.some(r => pool[r].length)) return { ok: false, error: "No cards available for this pack yet." };

  p.packs[type] -= 1;
  const results = [];
  let gotRarePlus = false, gotLegendary = false;
  const forceLegendary = p.pity + 1 >= PITY_LIMIT;
  for (let slot = 0; slot < def.size; slot++) {
    const last = slot === def.size - 1;
    let rarity = rollRarity(rng, last && !gotRarePlus, def, last && forceLegendary && !gotLegendary);
    // Fall back to the nearest rarity that actually has cards.
    let idx = RARITIES.indexOf(rarity);
    while (idx >= 0 && !pool[RARITIES[idx]].length) idx--;
    if (idx < 0) idx = RARITIES.findIndex(r => pool[r].length);
    rarity = RARITIES[idx];
    const list = pool[rarity];
    const id = list[Math.floor(rng() * list.length)];
    const shiny = rng() < def.shinyChance + (rarity === "legendary" ? 0.1 : 0);
    const isNew = !ownedCount(p, id) && !results.some(r => r.id === id);
    addCard(p, id, shiny);
    if (rarity !== "common") gotRarePlus = true;
    if (rarity === "legendary") gotLegendary = true;
    results.push({ id, shiny, isNew, rarity });
  }
  p.pity = gotLegendary ? 0 : p.pity + 1;
  p.stats.packsOpened += 1;
  return { ok: true, cards: results };
}

export function extrasOf(p, id, catalog) {
  const card = catalog[id];
  return card ? Math.max(0, ownedCount(p, id) - MAX_COPIES[card.rarity]) : 0;
}

export function recycleExtras(p, catalog) {
  let coins = 0, count = 0;
  for (const [id, entry] of Object.entries(p.cards)) {
    const card = catalog[id];
    if (!card) continue;
    const extra = Math.max(0, entry.n - MAX_COPIES[card.rarity]);
    if (!extra) continue;
    // Keep shinies when possible: recycle plain copies first.
    const plainOut = Math.min(extra, entry.n - entry.s);
    const shinyOut = extra - plainOut;
    coins += plainOut * RECYCLE_VALUE[card.rarity] + shinyOut * RECYCLE_VALUE[card.rarity] * 2;
    entry.n -= extra;
    entry.s -= shinyOut;
    count += extra;
  }
  p.coins += coins;
  return { ok: true, coins, count };
}

export function craftCard(p, id, catalog) {
  const card = catalog[id];
  if (!card || card.token) return { ok: false, error: "That card can't be crafted." };
  if (ownedCount(p, id) >= MAX_COPIES[card.rarity]) return { ok: false, error: "You already have the max playable copies." };
  const cost = CRAFT_COST[card.rarity];
  if (p.coins < cost) return { ok: false, error: `You need ${cost - p.coins} more coins.` };
  p.coins -= cost;
  addCard(p, id, false);
  delete p.newCards[id];
  return { ok: true };
}

// Apply a finished match. `kind` is "solo" or "online"; `cap` limits coins per day.
export function recordResult(p, { won, reward, day, kind = "solo", cap = Infinity }) {
  if (p.rewardDay.day !== day) p.rewardDay = { day, solo: 0, online: 0 };
  let coins = Math.max(0, Math.floor(reward) || 0);
  let firstWin = false;
  if (won) {
    p.stats.wins += 1;
    p.stats.streak += 1;
    if (p.lastWinDay !== day) { p.lastWinDay = day; coins += FIRST_WIN_BONUS; firstWin = true; }
  } else {
    p.stats.losses += 1;
    p.stats.streak = 0;
  }
  const room = Math.max(0, cap - (p.rewardDay[kind] || 0));
  const capped = coins > room;
  coins = Math.min(coins, room);
  p.rewardDay[kind] = (p.rewardDay[kind] || 0) + coins;
  p.coins += coins;
  return { ok: true, coins, firstWin, capped };
}

// Fields a logged-in player's device may change directly. Everything else
// (coins, packs, cards, pity, stats, rewards) only changes through server actions.
export function mergeClientEdits(server, client, { username } = {}) {
  const p = normalizeProfile(server);
  const c = client && typeof client === "object" ? client : {};
  if (Array.isArray(c.decks)) {
    p.decks = c.decks.slice(0, 6).map(d => ({
      id: String(d?.id || "").slice(0, 40),
      name: String(d?.name || "Deck").slice(0, 24),
      cards: Array.isArray(d?.cards) ? d.cards.slice(0, 40).map(x => String(x).slice(0, 80)) : [],
      updated: Number(d?.updated) || Date.now(),
      ...(d?.curve2 ? { curve2: true } : {})
    })).filter(d => d.id);
  }
  if (typeof c.activeDeck === "string" || c.activeDeck === null) p.activeDeck = c.activeDeck ? c.activeDeck.slice(0, 40) : null;
  if (c.settings && typeof c.settings === "object") p.settings = { sound: c.settings.sound !== false, haptics: c.settings.haptics !== false };
  if (c.newCards && typeof c.newCards === "object") {
    p.newCards = {};
    for (const id of Object.keys(c.newCards).slice(0, 500)) if (ownedCount(p, id)) p.newCards[id] = true;
  }
  if (typeof c.hero === "string" && ownedCount(p, c.hero)) p.hero = c.hero;
  if (typeof c.tutorialSeen === "boolean") p.tutorialSeen = c.tutorialSeen;
  if (username) p.name = username;
  return p;
}

// A guest bringing local progress into a new account: keep it, but only what's plausible
// for how many packs they've opened, so edited local saves can't mint a collection.
export function importGuestProfile(guest, catalog) {
  const g = normalizeProfile(guest);
  const p = freshProfile();
  const opened = Math.min(40, Math.max(0, Math.floor(g.stats.packsOpened || 0)));
  let budget = opened * 5;
  const cards = { ...p.cards };
  for (const [id, entry] of Object.entries(g.cards)) {
    if (!catalog[id] || catalog[id].token) continue;
    const have = cards[id]?.n || 0;
    const extra = Math.min(Math.max(0, Math.floor(entry?.n || 0) - have), budget);
    if (extra <= 0) continue;
    budget -= extra;
    cards[id] = { n: have + extra, s: Math.min(have + extra, Math.max(0, Math.floor(entry?.s || 0))) };
  }
  p.cards = cards;
  p.coins = Math.min(g.coins, 1500);
  p.packs = { goober: Math.min(g.packs.goober || 0, 10), gallery: Math.min(g.packs.gallery || 0, 10) };
  p.pity = Math.min(g.pity, PITY_LIMIT - 1);
  p.stats = { ...p.stats, packsOpened: opened, wins: Math.min(g.stats.wins, 500), losses: Math.min(g.stats.losses, 500), shinies: Math.min(g.stats.shinies, 200) };
  p.lastDaily = g.lastDaily;
  return mergeClientEdits(p, g);
}
