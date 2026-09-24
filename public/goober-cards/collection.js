// Player profile: coins, card collection, packs, and decks, cached on this device.
// Guests' economy runs here; logged-in players' economy runs on the server
// (see account.js), which sends back the updated profile.
import { MAX_COPIES, DECK_SIZE, autoDeck, validateDeck } from "./cards.js";
import * as econ from "./economy.js";

const STORAGE_KEY = "gooberCardsProfile.v2";

export const { PACKS, RECYCLE_VALUE, CRAFT_COST, PITY_LIMIT } = econ;
export const MAX_DECKS = 6;

const today = () => econ.localDay();
const freshProfile = econ.freshProfile;
const normalize = econ.normalizeProfile;

let profile = null;

export function loadProfile() {
  if (profile) return profile;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) profile = normalize(JSON.parse(raw));
  } catch { profile = null; }
  if (!profile) profile = freshProfile();
  return profile;
}

// Called after every local save (the account module uses it to sync to the cloud).
let saveHook = null;
export function setSaveHook(fn) { saveHook = fn; }

export function saveProfile() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage full or blocked */ }
  saveHook?.(profile);
}

// Swap in a profile that came from the player's account.
export function replaceProfile(data) {
  profile = normalize(data);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage full or blocked */ }
  return profile;
}

// Take the server's economy (coins, cards, packs...) but keep this device's own edits.
export function adoptServerProfile(server) {
  return replaceProfile(econ.adoptOnDevice(server, loadProfile()));
}

// Wipe this device's copy (on log out) so the next person starts fresh.
export function resetProfile() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  profile = null;
  return loadProfile();
}

// A brand-new profile hasn't done anything worth keeping yet.
export function hasProgress() {
  const p = loadProfile();
  return p.stats.wins + p.stats.losses + p.stats.packsOpened > 0 || p.decks.length > 0;
}

export function owned(id) { return loadProfile().cards[id]?.n || 0; }
export function ownedShiny(id) { return loadProfile().cards[id]?.s || 0; }
export function ownedCounts() {
  const out = {};
  for (const [id, entry] of Object.entries(loadProfile().cards)) out[id] = entry.n || 0;
  return out;
}

// Clearing a "new" badge is queued so a logged-in save can tell the server.
export function markSeen(id) {
  const p = loadProfile();
  if (!p.newCards[id]) return;
  delete p.newCards[id];
  p.seenQueue = [...(p.seenQueue || []).filter(x => x !== id), id].slice(-500);
  saveProfile();
}

// --- Guest economy (logged-in players use the server; see account.js) -----------
export function claimDaily() {
  const res = econ.claimDaily(loadProfile(), today());
  if (!res.ok) return null;
  saveProfile();
  return { packs: 1 };
}

export function buyPack(type) {
  const res = econ.buyPack(loadProfile(), type);
  if (res.ok) saveProfile();
  return res;
}

export function openPack(type, catalog) {
  const res = econ.openPack(loadProfile(), type, catalog);
  if (res.ok) saveProfile();
  return res;
}

export function extrasOf(id, catalog) { return econ.extrasOf(loadProfile(), id, catalog); }

export function recycleExtras(catalog) {
  const res = econ.recycleExtras(loadProfile(), catalog);
  saveProfile();
  return res;
}

export function craftCard(id, catalog) {
  const res = econ.craftCard(loadProfile(), id, catalog);
  if (res.ok) saveProfile();
  return res;
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
  // Auto-built starter decks from before the cost rebalance get rebuilt once.
  for (const d of p.decks) {
    if (d.name === "Starter Deck" && !d.curve2) {
      const cards = autoDeck(catalog, ownedCounts());
      if (validateDeck(catalog, cards).ok) d.cards = cards;
      d.curve2 = true;
      saveProfile();
    }
  }
  let deck = getDeck(p.activeDeck);
  if (!deck || deckProblems(deck, catalog).length) deck = p.decks.find(d => !deckProblems(d, catalog).length) || null;
  if (!deck) {
    const cards = autoDeck(catalog, ownedCounts());
    if (validateDeck(catalog, cards).ok) {
      deck = createDeck(catalog, "Starter Deck", cards) || { id: "auto", name: "Starter Deck", cards };
      deck.curve2 = true;
      saveProfile();
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
  const res = econ.recordResult(loadProfile(), { won, reward, day: today() });
  saveProfile();
  return res;
}
