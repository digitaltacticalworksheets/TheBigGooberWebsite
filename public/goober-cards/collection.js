// Player profile: coins, card collection, packs, and decks. Stored on this device.
import { MAX_COPIES, DECK_SIZE, RARITIES, autoDeck, validateDeck } from "./cards.js";

const STORAGE_KEY = "gooberCardsProfile.v2";

export const PACKS = {
  goober: { id: "goober", name: "Goober Pack", price: 100, size: 5, blurb: "5 cards from the whole set. At least one Rare or better.", color: "#ffd34d", shinyChance: 0.06, onlyGoobers: false },
  gallery: { id: "gallery", name: "Gallery Pack", price: 150, size: 5, blurb: "Only uploaded Goobers. Better odds for shinies and Epics.", color: "#ff8bd1", shinyChance: 0.12, onlyGoobers: true, epicBoost: true }
};

export const RECYCLE_VALUE = { common: 5, rare: 20, epic: 60, legendary: 200 };
export const CRAFT_COST = { common: 40, rare: 100, epic: 300, legendary: 800 };
export const PITY_LIMIT = 10;
export const MAX_DECKS = 6;

const STARTER = [
  ["treat-bonk", 2], ["treat-belly-rub", 2], ["treat-snack-time", 2], ["treat-zoomies", 2],
  ["treat-cozy-blanket", 2], ["treat-squeaky-toy", 2], ["cool-goober", 2], ["party-goober", 2], ["cowboy-goober", 1]
];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function freshProfile() {
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
    settings: { sound: true, haptics: true },
    tutorialSeen: false,
    created: Date.now()
  };
}

let profile = null;

export function loadProfile() {
  if (profile) return profile;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) profile = { ...freshProfile(), ...JSON.parse(raw) };
  } catch { profile = null; }
  if (!profile) profile = freshProfile();
  profile.settings = { sound: true, haptics: true, ...(profile.settings || {}) };
  profile.stats = { ...freshProfile().stats, ...(profile.stats || {}) };
  profile.packs = { goober: 0, gallery: 0, ...(profile.packs || {}) };
  return profile;
}

export function saveProfile() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage full or blocked */ }
}

export function owned(id) { return loadProfile().cards[id]?.n || 0; }
export function ownedShiny(id) { return loadProfile().cards[id]?.s || 0; }
export function ownedCounts() {
  const out = {};
  for (const [id, entry] of Object.entries(loadProfile().cards)) out[id] = entry.n || 0;
  return out;
}

export function addCard(id, shiny = false) {
  const p = loadProfile();
  const entry = p.cards[id] || { n: 0, s: 0 };
  if (!entry.n) p.newCards[id] = true;
  entry.n += 1;
  if (shiny) { entry.s += 1; p.stats.shinies += 1; }
  p.cards[id] = entry;
}

export function markSeen(id) { const p = loadProfile(); if (p.newCards[id]) { delete p.newCards[id]; saveProfile(); } }

// Daily gift: one free Goober Pack per calendar day.
export function claimDaily() {
  const p = loadProfile();
  if (p.lastDaily === today()) return null;
  p.lastDaily = today();
  p.packs.goober += 1;
  saveProfile();
  return { packs: 1 };
}

export function buyPack(type) {
  const p = loadProfile(), def = PACKS[type];
  if (!def) return { ok: false, error: "Unknown pack." };
  if (p.coins < def.price) return { ok: false, error: `You need ${def.price - p.coins} more coins.` };
  p.coins -= def.price;
  p.packs[type] = (p.packs[type] || 0) + 1;
  saveProfile();
  return { ok: true };
}

function rollRarity(guaranteeRare, def, forceLegendary) {
  if (forceLegendary) return "legendary";
  const r = Math.random() * 100;
  const epicOdds = def.epicBoost ? 12 : 7;
  if (r < 2.5) return "legendary";
  if (r < 2.5 + epicOdds) return "epic";
  if (r < 30 || guaranteeRare) return "rare";
  return "common";
}

// Open one pack. Returns [{id, shiny, isNew, rarity}] or an error.
export function openPack(type, catalog) {
  const p = loadProfile(), def = PACKS[type];
  if (!def || !(p.packs[type] > 0)) return { ok: false, error: "No packs of that kind to open." };
  const pool = {};
  for (const r of RARITIES) pool[r] = [];
  for (const card of Object.values(catalog)) {
    if (card.token) continue;
    if (def.onlyGoobers && card.type !== "minion") continue;
    pool[card.rarity].push(card.id);
  }
  const total = RARITIES.reduce((n, r) => n + pool[r].length, 0);
  if (!total) return { ok: false, error: "No cards available for this pack yet." };

  p.packs[type] -= 1;
  const results = [];
  let gotRarePlus = false, gotLegendary = false;
  const forceLegendary = p.pity + 1 >= PITY_LIMIT;
  for (let slot = 0; slot < def.size; slot++) {
    const last = slot === def.size - 1;
    let rarity = rollRarity(last && !gotRarePlus, def, last && forceLegendary && !gotLegendary);
    // Fall back to the nearest rarity that actually has cards.
    let idx = RARITIES.indexOf(rarity);
    while (idx >= 0 && !pool[RARITIES[idx]].length) idx--;
    if (idx < 0) { idx = RARITIES.findIndex(r => pool[r].length); }
    rarity = RARITIES[idx];
    const list = pool[rarity];
    const id = list[Math.floor(Math.random() * list.length)];
    const shiny = Math.random() < def.shinyChance + (rarity === "legendary" ? 0.1 : 0);
    const isNew = !owned(id) && !results.some(r => r.id === id);
    addCard(id, shiny);
    if (rarity !== "common") gotRarePlus = true;
    if (rarity === "legendary") gotLegendary = true;
    results.push({ id, shiny, isNew, rarity });
  }
  p.pity = gotLegendary ? 0 : p.pity + 1;
  p.stats.packsOpened += 1;
  saveProfile();
  return { ok: true, cards: results };
}

export function extrasOf(id, catalog) {
  const card = catalog[id];
  if (!card) return 0;
  return Math.max(0, owned(id) - MAX_COPIES[card.rarity]);
}

export function recycleExtras(catalog) {
  const p = loadProfile();
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
  saveProfile();
  return { coins, count };
}

export function craftCard(id, catalog) {
  const p = loadProfile(), card = catalog[id];
  if (!card || card.token) return { ok: false, error: "That card can't be crafted." };
  if (owned(id) >= MAX_COPIES[card.rarity]) return { ok: false, error: "You already have the max playable copies." };
  const cost = CRAFT_COST[card.rarity];
  if (p.coins < cost) return { ok: false, error: `You need ${cost - p.coins} more coins.` };
  p.coins -= cost;
  addCard(id, false);
  delete p.newCards[id];
  saveProfile();
  return { ok: true };
}

// --- Decks -------------------------------------------------------------------
function deckId() { return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`; }

export function getDecks() { return loadProfile().decks; }
export function getDeck(id) { return loadProfile().decks.find(d => d.id === id) || null; }

export function createDeck(catalog, name = null, cards = null) {
  const p = loadProfile();
  if (p.decks.length >= MAX_DECKS) return null;
  const deck = { id: deckId(), name: name || `Deck ${p.decks.length + 1}`, cards: cards || autoDeck(catalog, ownedCounts()), updated: Date.now() };
  p.decks.push(deck);
  if (!p.activeDeck) p.activeDeck = deck.id;
  saveProfile();
  return deck;
}

export function saveDeck(deck) {
  const p = loadProfile();
  const i = p.decks.findIndex(d => d.id === deck.id);
  deck.updated = Date.now();
  if (i >= 0) p.decks[i] = deck; else p.decks.push(deck);
  saveProfile();
}

export function deleteDeck(id) {
  const p = loadProfile();
  p.decks = p.decks.filter(d => d.id !== id);
  if (p.activeDeck === id) p.activeDeck = p.decks[0]?.id || null;
  saveProfile();
}

// Cards in a deck the player doesn't (fully) own anymore, or that left the catalog.
export function deckProblems(deck, catalog) {
  const counts = {};
  const problems = [];
  for (const id of deck.cards) counts[id] = (counts[id] || 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    if (!catalog[id]) problems.push(`A card in this deck no longer exists.`);
    else if (n > owned(id)) problems.push(`You only own ${owned(id)} of ${catalog[id].name}.`);
  }
  if (deck.cards.length !== DECK_SIZE) problems.push(`Needs ${DECK_SIZE} cards (has ${deck.cards.length}).`);
  const v = validateDeck(catalog, deck.cards);
  if (!v.ok && !problems.length) problems.push(v.error);
  return problems;
}

// Deck to take into a game: the active deck if valid, otherwise a fresh auto deck.
export function playableDeck(catalog) {
  const p = loadProfile();
  let deck = getDeck(p.activeDeck);
  if (!deck || deckProblems(deck, catalog).length) deck = p.decks.find(d => !deckProblems(d, catalog).length) || null;
  if (!deck) {
    const cards = autoDeck(catalog, ownedCounts());
    if (validateDeck(catalog, cards).ok) {
      deck = createDeck(catalog, "Starter Deck", cards) || { id: "auto", name: "Starter Deck", cards };
    } else {
      deck = { id: "auto", name: "Loaner Deck", cards: autoDeck(catalog) };
    }
  }
  const shinyLeft = {};
  for (const id of deck.cards) shinyLeft[id] = shinyLeft[id] ?? ownedShiny(id);
  return {
    deck,
    entries: deck.cards.map(id => {
      const shiny = shinyLeft[id] > 0;
      if (shiny) shinyLeft[id] -= 1;
      return { id, shiny };
    })
  };
}

export function recordResult({ won, reward }) {
  const p = loadProfile();
  let coins = reward;
  let firstWin = false;
  if (won) {
    p.stats.wins += 1;
    p.stats.streak += 1;
    if (p.lastWinDay !== today()) { p.lastWinDay = today(); coins += 50; firstWin = true; }
  } else {
    p.stats.losses += 1;
    p.stats.streak = 0;
  }
  p.coins += coins;
  saveProfile();
  return { coins, firstWin };
}
