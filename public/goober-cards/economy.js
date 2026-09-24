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
    editsRev: 0,
    paidGames: [],
    rank: freshRank(),
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
  p.editsRev = Math.max(0, Math.floor(Number(p.editsRev) || 0));
  p.paidGames = Array.isArray(p.paidGames) ? p.paidGames.slice(-30) : [];
  p.rank = { ...freshRank(), ...(p.rank && typeof p.rank === "object" ? p.rank : {}) };
  p.rank.rp = Math.max(0, Math.floor(Number(p.rank.rp) || 0));
  return p;
}

// --- Ranked (Find a Match only, logged-in players on both sides) -----------
// Rank Points climb through bread tiers. You can't drop out of a tier once you reach it.
export const RANK_TIERS = [
  { id: "crumb", name: "Crumb", icon: "🌾", min: 0 },
  { id: "toast", name: "Toast", icon: "🍞", min: 100 },
  { id: "bagel", name: "Bagel", icon: "🥯", min: 200 },
  { id: "croissant", name: "Croissant", icon: "🥐", min: 325 },
  { id: "baguette", name: "Baguette", icon: "🥖", min: 475 },
  { id: "golden", name: "Golden Loaf", icon: "👑", min: 650 }
];
export const RANK_POINTS = { win: 25, loss: 15, streakBonus: 5, maxStreakBonus: 15 };

function freshRank() { return { rp: 0, best: 0, wins: 0, losses: 0, streak: 0 }; }

export function tierFor(rp) {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if ((rp || 0) >= t.min) tier = t;
  return tier;
}

export function nextTier(rp) { return RANK_TIERS.find(t => t.min > (rp || 0)) || null; }

// Apply one ranked result. Draws change nothing.
export function recordRanked(p, { won, draw = false }) {
  const r = p.rank;
  const before = r.rp;
  if (!draw) {
    if (won) {
      r.streak += 1;
      r.wins += 1;
      const bonus = Math.min(RANK_POINTS.maxStreakBonus, Math.max(0, r.streak - 2) * RANK_POINTS.streakBonus);
      r.rp += RANK_POINTS.win + bonus;
    } else {
      r.streak = 0;
      r.losses += 1;
      r.rp = Math.max(tierFor(before).min, r.rp - RANK_POINTS.loss);
    }
  }
  r.best = Math.max(r.best, r.rp);
  const from = tierFor(before), to = tierFor(r.rp);
  return { before, after: r.rp, delta: r.rp - before, tier: to.id, promoted: to.min > from.min, streak: r.streak };
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
// "New" badges are added by the server (pack opens) and cleared by the device
// through `seenQueue`, so neither side can wipe out the other's changes.
function applyEditableFields(p, c) {
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
  if (typeof c.hero === "string" && ownedCount(p, c.hero)) p.hero = c.hero;
  if (typeof c.tutorialSeen === "boolean") p.tutorialSeen = c.tutorialSeen;
}

const seenList = c => (Array.isArray(c?.seenQueue) ? c.seenQueue.slice(0, 500).map(String) : []);

// Server side of a device save: apply the device's edits and badge clears.
export function mergeClientEdits(server, client, { username } = {}) {
  const p = normalizeProfile(server);
  const c = client && typeof client === "object" ? client : {};
  applyEditableFields(p, c);
  for (const id of seenList(c)) delete p.newCards[id];
  delete p.seenQueue;
  if (username) p.name = username;
  return p;
}

// Device side: take the server's profile but keep this device's unsaved edits
// and badge clears (they'll be sent on the next save).
export function adoptOnDevice(server, local) {
  const p = normalizeProfile(server);
  const c = local && typeof local === "object" ? local : {};
  applyEditableFields(p, c);
  const seen = seenList(c);
  for (const id of seen) delete p.newCards[id];
  p.seenQueue = seen;
  return p;
}

// Guest progress brought into a new account. The guest save lives on the device and can
// be edited, so only a small, fixed allowance comes along (roughly the free starting
// packs): no card beyond deck limits, at most one Legendary, a few shinies, capped coins.
export const GUEST_IMPORT = { extraCards: 20, legendaries: 1, shinies: 3, coins: 500, packs: 3 };

export function importGuestProfile(guest, catalog) {
  const g = normalizeProfile(guest);
  const p = freshProfile();
  let budget = GUEST_IMPORT.extraCards, legendaries = 0, shinies = 0;
  for (const [id, entry] of Object.entries(g.cards)) {
    const card = catalog[id];
    if (!card || card.token) continue;
    const have = p.cards[id]?.n || 0;
    const want = Math.min(Math.floor(entry?.n || 0), MAX_COPIES[card.rarity]);
    let extra = Math.min(Math.max(0, want - have), budget);
    if (card.rarity === "legendary") { extra = Math.min(extra, GUEST_IMPORT.legendaries - legendaries); legendaries += Math.max(0, extra); }
    if (extra <= 0) continue;
    budget -= extra;
    const n = have + extra;
    const s = Math.min(n, Math.max(0, Math.floor(entry?.s || 0)), GUEST_IMPORT.shinies - shinies);
    shinies += s;
    p.cards[id] = { n, s };
  }
  p.coins = Math.min(g.coins, GUEST_IMPORT.coins);
  p.packs = { goober: Math.min(g.packs.goober || 0, GUEST_IMPORT.packs), gallery: Math.min(g.packs.gallery || 0, GUEST_IMPORT.packs) };
  p.lastDaily = g.lastDaily;
  applyEditableFields(p, g);
  return p;
}
