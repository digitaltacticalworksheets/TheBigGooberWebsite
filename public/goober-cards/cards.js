// Shared card catalog for Goober Cards.
// Used by the browser (collection, packs, solo games) and by the worker (online rooms),
// so everything here must stay pure: no DOM, no storage, no network.

export const RARITIES = ["common", "rare", "epic", "legendary"];
export const RARITY_LABEL = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
export const MAX_COPIES = { common: 2, rare: 2, epic: 2, legendary: 1 };
export const DECK_SIZE = 20;

export const KEYWORDS = {
  guard: { label: "Tank", icon: "🛡️", text: "Enemies have to attack this first." },
  zoomies: { label: "Speedrun", icon: "💨", text: "Can attack the turn it's played." },
  fluffy: { label: "Plot Armor", icon: "🎬", text: "Ignores the first damage it takes." },
  lifesnack: { label: "Leech", icon: "🧛", text: "Damage it deals heals your hero." },
  doubleWag: { label: "Double Tap", icon: "✌️", text: "Can attack twice each turn." },
  bitey: { label: "One-Shot", icon: "💀", text: "Destroys any minion it damages." },
  sneaky: { label: "Ghosting", icon: "👻", text: "Can't be targeted until it attacks." }
};

export const TRIGGER_LABEL = { battlecry: "Entrance:", lastBark: "Last Words:", endTurn: "End of turn:" };

export const CATEGORIES = ["classic", "costume", "chaos", "funny", "spooky", "animal", "food", "sports", "holiday", "fancy", "superhero", "random"];

export const CATEGORY_STYLE = {
  classic: { color: "#ffd34d", icon: "🍞" },
  costume: { color: "#ff9f45", icon: "🎩" },
  chaos: { color: "#b28dff", icon: "🌀" },
  funny: { color: "#ffe066", icon: "🤪" },
  spooky: { color: "#6f7c91", icon: "👻" },
  animal: { color: "#98e7a7", icon: "🐸" },
  food: { color: "#ff8f8f", icon: "🍕" },
  sports: { color: "#8ed3ff", icon: "⚽" },
  holiday: { color: "#5fd39b", icon: "🎄" },
  fancy: { color: "#ff8bd1", icon: "💎" },
  superhero: { color: "#ff6b6b", icon: "🦸" },
  random: { color: "#c9c3b8", icon: "🎲" },
  treat: { color: "#f5e6c8", icon: "🦴" },
  token: { color: "#e8e1d4", icon: "🐶" }
};

export const HERO_POWER = { name: "BARK FART", cost: 2, damage: 1, text: "Bark, then fart. Deal 1 damage to an enemy." };

// Token minions summoned by abilities (not collectible).
export const TOKENS = {
  "token-pup": { id: "token-pup", type: "minion", name: "Lil Goober", cost: 1, attack: 1, health: 1, rarity: "common", category: "token", keywords: [], art: { emoji: "🐶" }, text: "", token: true },
  "token-loaf": { id: "token-loaf", type: "minion", name: "Loaf", cost: 1, attack: 0, health: 3, rarity: "common", category: "token", keywords: ["guard"], art: { emoji: "🍞" }, text: "", token: true },
  "token-ghost": { id: "token-ghost", type: "minion", name: "Ghost Goober", cost: 1, attack: 2, health: 1, rarity: "common", category: "token", keywords: ["sneaky"], art: { emoji: "👻" }, text: "", token: true },
  "token-crumb": { id: "token-crumb", type: "spell", name: "Bonus Aura", cost: 0, rarity: "common", category: "token", keywords: [], art: { emoji: "🪙" }, effect: { type: "mana", amount: 1 }, text: "Gain 1 Aura this turn only.", token: true }
};

// Built-in "Treat" spells. These are always part of the card pool so decks work
// even when only a handful of Goobers have been uploaded.
export const TREATS = [
  { id: "treat-bonk", name: "Bonk", cost: 1, rarity: "common", art: { emoji: "🔨" }, effect: { type: "damage", amount: 2, target: "any" }, flavor: "*vine boom sound effect*" },
  { id: "treat-belly-rub", name: "Touch Grass", cost: 1, rarity: "common", art: { emoji: "🌱" }, effect: { type: "heal", amount: 4, target: "friendly", draw: 1 }, flavor: "Log off. Heal up. Come back different." },
  { id: "treat-snack-time", name: "Doomscroll", cost: 2, rarity: "common", art: { emoji: "📱" }, effect: { type: "draw", amount: 2 }, flavor: "Just one more. Then bed. (Lie.)" },
  { id: "treat-zoomies", name: "Sigma Grindset", cost: 1, rarity: "common", art: { emoji: "🗿" }, effect: { type: "buff", attack: 2, health: 0, target: "friendlyMinion", keyword: "zoomies" }, flavor: "Wakes up at 4am. Attacks immediately." },
  { id: "treat-cozy-blanket", name: "Built Different", cost: 2, rarity: "common", art: { emoji: "💪" }, effect: { type: "buff", attack: 1, health: 2, target: "friendlyMinion", keyword: "guard" }, flavor: "Not like the other Goobers." },
  { id: "treat-squeaky-toy", name: "Call the Squad", cost: 2, rarity: "common", art: { emoji: "📞" }, effect: { type: "summon", token: "token-pup", count: 2 }, flavor: "Pull up. All of you." },
  { id: "treat-nap-time", name: "Get Muted", cost: 2, rarity: "rare", art: { emoji: "🔇" }, effect: { type: "freeze", target: "enemyMinion", damage: 1 }, flavor: "Nobody asked." },
  { id: "treat-fetch", name: "Yeet", cost: 3, rarity: "rare", art: { emoji: "🚀" }, effect: { type: "damage", amount: 4, target: "enemyMinion", draw: 1 }, flavor: "Reduced to atoms." },
  { id: "treat-bath-time", name: "Spam the Chat", cost: 3, rarity: "rare", art: { emoji: "💬" }, effect: { type: "damage", amount: 1, target: "allEnemyMinions", freeze: true }, flavor: "@everyone" },
  { id: "treat-pizza-party", name: "Aura Farming", cost: 4, rarity: "epic", art: { emoji: "😎" }, effect: { type: "buff", attack: 1, health: 1, target: "allFriendlyMinions", heal: 4 }, flavor: "+1000 aura for the whole squad." },
  { id: "treat-thunder", name: "Emotional Damage", cost: 5, rarity: "epic", art: { emoji: "😭" }, effect: { type: "damage", amount: 3, target: "allEnemyMinions" }, flavor: "Not physical. Worse." },
  { id: "treat-big-goober-energy", name: "Big Goober Energy", cost: 6, rarity: "legendary", art: { emoji: "👑" }, effect: { type: "buff", attack: 2, health: 2, target: "allFriendlyMinions", summon: "token-pup", summonCount: 2 }, flavor: "The loaf becomes the legend. Unironically." }
].map(card => ({ ...card, type: "spell", category: "treat", keywords: [], text: describeEffect(card.effect, "spell") }));

// The original Goobers from the site, hand-tuned.
const ORIGINALS = [
  { id: "original-goober", name: "Original Goober", category: "classic", rarity: "legendary", cost: 5, attack: 4, health: 6, keywords: ["guard"], ability: { trigger: "battlecry", type: "buff", attack: 1, health: 1, target: "allFriendlyMinions" }, image: "/assets/original-goober.jpg", flavor: "The founding Goober. Soft, simple, and completely loafed up." },
  { id: "cowboy-goober", name: "Cowboy Goober", category: "costume", rarity: "epic", cost: 3, attack: 3, health: 2, keywords: [], ability: { trigger: "battlecry", type: "damage", amount: 2, target: "any" }, image: "/assets/cowboy-goober.jpg", flavor: "Rootin', tootin', and one hundred percent loaf." },
  { id: "cool-goober", name: "Cool Goober", category: "costume", rarity: "rare", cost: 2, attack: 2, health: 2, keywords: ["sneaky"], ability: null, image: "/assets/cool-goober.jpg", flavor: "Too cool to explain anything. Still a loaf." },
  { id: "spider-goober", name: "Spider Goober", category: "chaos", rarity: "epic", cost: 4, attack: 3, health: 3, keywords: ["bitey"], ability: { trigger: "lastBark", type: "summon", token: "token-pup", count: 2 }, image: "/assets/spider-goober.jpg", flavor: "A mysterious multi-legged Goober loaf. Probably friendly. Probably." },
  { id: "party-goober", name: "Party Goober", category: "holiday", rarity: "rare", cost: 3, attack: 2, health: 3, keywords: [], ability: { trigger: "battlecry", type: "summon", token: "token-pup", count: 1 }, image: "/assets/Party Goober.jpg", flavor: "Brought a cake. Ate the cake. Zero regrets." }
].map(card => ({ ...card, type: "minion", art: { image: card.image }, text: describeMinion(card) }));

// --- Generation for user-uploaded Goobers ---------------------------------

// Abilities each category tends to roll, with a "budget" cost in stat points.
const CATEGORY_ABILITIES = {
  classic: [["kw", "guard", 1], ["bc-buff-self", 1]],
  costume: [["bc-buff-friend", 2], ["kw", "fluffy", 2]],
  chaos: [["bc-dmg-random", 2], ["lb-dmg-random", 2], ["kw", "bitey", 2]],
  funny: [["bc-draw", 3], ["lb-draw", 2]],
  spooky: [["lb-summon-ghost", 2], ["kw", "sneaky", 1], ["lb-dmg-random", 2]],
  animal: [["kw", "zoomies", 2], ["bc-summon-pup", 2]],
  food: [["kw", "lifesnack", 2], ["bc-heal-hero", 1]],
  sports: [["kw", "zoomies", 2], ["kw", "doubleWag", 3]],
  holiday: [["bc-summon-pup", 2], ["et-buff-random", 2]],
  fancy: [["kw", "fluffy", 2], ["bc-armor", 1]],
  superhero: [["bc-dmg-target", 2], ["kw", "fluffy", 2], ["kw", "guard", 1]],
  random: [["bc-dmg-random", 2], ["bc-draw", 3], ["kw", "zoomies", 2], ["lb-summon-pup", 2]]
};

const RARITY_BONUS = { common: 0, rare: 1, epic: 2, legendary: 3 };
// Weighted toward cheap cards so every deck has early plays.
const COST_TABLE = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7];

export function hashString(text) {
  let h = 2166136261;
  const str = String(text);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pick(list, seed) { return list[seed % list.length]; }

export function rarityFor(id) {
  const roll = hashString(`${id}-rarity`) % 100;
  if (roll < 6) return "legendary";
  if (roll < 22) return "epic";
  if (roll < 50) return "rare";
  return "common";
}

function abilityFromCode(code, cost, rarity) {
  const scale = Math.max(1, Math.round(cost / 2)) + (rarity === "legendary" ? 1 : 0);
  switch (code) {
    case "bc-buff-self": return { trigger: "battlecry", type: "buff", attack: 1, health: 1, target: "self", perFriend: true };
    case "bc-buff-friend": return { trigger: "battlecry", type: "buff", attack: Math.min(3, scale), health: Math.min(3, scale), target: "friendlyMinion" };
    case "bc-dmg-random": return { trigger: "battlecry", type: "damage", amount: scale + 1, target: "randomEnemy" };
    case "bc-dmg-target": return { trigger: "battlecry", type: "damage", amount: scale, target: "any" };
    case "lb-dmg-random": return { trigger: "lastBark", type: "damage", amount: scale + 1, target: "randomEnemy" };
    case "bc-draw": return { trigger: "battlecry", type: "draw", amount: cost >= 5 ? 2 : 1 };
    case "lb-draw": return { trigger: "lastBark", type: "draw", amount: 1 };
    case "lb-summon-ghost": return { trigger: "lastBark", type: "summon", token: "token-ghost", count: cost >= 5 ? 2 : 1 };
    case "lb-summon-pup": return { trigger: "lastBark", type: "summon", token: "token-pup", count: cost >= 4 ? 2 : 1 };
    case "bc-summon-pup": return { trigger: "battlecry", type: "summon", token: cost >= 5 ? "token-loaf" : "token-pup", count: cost >= 3 ? 2 : 1 };
    case "bc-heal-hero": return { trigger: "battlecry", type: "heal", amount: 2 + scale, target: "friendlyHero" };
    case "bc-armor": return { trigger: "battlecry", type: "armor", amount: 1 + scale };
    case "et-buff-random": return { trigger: "endTurn", type: "buff", attack: 1, health: 1, target: "randomFriendlyMinion" };
    default: return null;
  }
}

// Turn a gallery Goober ({id, name, category, description, imageUrl}) into a card.
export function cardFromGoober(goober) {
  const id = `goober-${goober.id}`;
  const category = CATEGORIES.includes(goober.category) ? goober.category : "random";
  const h = hashString(goober.id);
  const rarity = rarityFor(goober.id);
  const cost = pick(COST_TABLE, hashString(`${goober.id}-cost`));
  let budget = cost * 2 + 1 + RARITY_BONUS[rarity];
  const keywords = [];
  let ability = null;

  const options = CATEGORY_ABILITIES[category];
  const rolls = rarity === "common" ? 1 : rarity === "legendary" ? 3 : 2;
  const hasAbility = rarity !== "common" || hashString(`${goober.id}-ability`) % 100 < 65;
  if (hasAbility) {
    for (let i = 0; i < rolls; i++) {
      const option = pick(options, hashString(`${goober.id}-ab${i}`));
      if (option[0] === "kw") {
        if (keywords.includes(option[1])) continue;
        if (keywords.length >= 2) continue;
        keywords.push(option[1]);
        budget -= option[2];
      } else if (!ability) {
        ability = abilityFromCode(option[0], cost, rarity);
        budget -= option[1];
      }
    }
  }
  budget = Math.max(2, budget);
  // Split the stat budget between attack and health based on the hash.
  const lean = (h % 5) - 2; // -2..2, positive = aggressive
  let attack = Math.round(budget / 2) + lean;
  if (keywords.includes("guard")) attack -= 1;
  attack = Math.max(cost <= 1 ? 1 : 0, Math.min(budget - 1, attack));
  let health = Math.max(1, budget - attack);
  if (keywords.includes("bitey")) { attack = Math.max(1, Math.min(attack, 2)); health = Math.max(1, budget - attack - 1); }

  const card = {
    id,
    gooberId: goober.id,
    type: "minion",
    name: String(goober.name || "Mystery Goober").slice(0, 40),
    category,
    rarity,
    cost,
    attack,
    health,
    keywords,
    ability,
    art: { image: goober.imageUrl || "" },
    flavor: String(goober.description || "").slice(0, 160)
  };
  card.text = describeMinion(card);
  return card;
}

// --- Text ------------------------------------------------------------------

function targetWords(target) {
  return ({
    any: "any target",
    enemy: "an enemy",
    enemyMinion: "an enemy minion",
    friendly: "a friendly character",
    friendlyMinion: "a friendly minion",
    randomEnemy: "a random enemy",
    allEnemyMinions: "all enemy minions",
    allEnemies: "all enemies",
    allFriendlyMinions: "your minions",
    randomFriendlyMinion: "a random friendly minion",
    friendlyHero: "your hero",
    self: "this"
  })[target] || "a target";
}

export function describeEffect(effect, source = "minion") {
  if (!effect) return "";
  const parts = [];
  switch (effect.type) {
    case "damage": parts.push(`Deal ${effect.amount} damage to ${targetWords(effect.target)}${effect.freeze ? " and mute them" : ""}.`); break;
    case "heal": parts.push(`Restore ${effect.amount} Health to ${targetWords(effect.target)}.`); break;
    case "draw": parts.push(`Draw ${effect.amount === 1 ? "a card" : `${effect.amount} cards`}.`); break;
    case "buff": {
      const stats = effect.attack && effect.health ? `+${effect.attack}/+${effect.health}` : effect.attack ? `+${effect.attack} Attack` : effect.health ? `+${effect.health} Health` : "";
      const kw = effect.keyword ? `${stats ? " and " : ""}${KEYWORDS[effect.keyword].label}` : "";
      if (effect.perFriend) parts.push("Gain +1/+1 for each other friendly minion.");
      else parts.push(`Give ${targetWords(effect.target)} ${stats}${kw}.`);
      break;
    }
    case "summon": {
      const token = TOKENS[effect.token];
      parts.push(`Summon ${effect.count === 1 ? "a" : effect.count} ${token.attack}/${token.health} ${token.name}${effect.count === 1 ? "" : "s"}.`);
      break;
    }
    case "mana": parts.push(`Gain ${effect.amount} Aura this turn only.`); break;
    case "armor": parts.push(`Gain ${effect.amount} Drip (armor).`); break;
    case "freeze": parts.push(`Deal ${effect.damage || 0} damage to ${targetWords(effect.target)}. It gets muted and can't attack next turn.`); break;
    default: break;
  }
  if (effect.heal) parts.push(`Restore ${effect.heal} Health to your hero.`);
  if (effect.summon) parts.push(`Summon ${effect.summonCount} ${TOKENS[effect.summon].name}s.`);
  if (effect.draw) parts.push(`Draw a card.`);
  return parts.join(" ");
}

export function describeMinion(card) {
  const bits = [];
  if (card.keywords?.length) bits.push(card.keywords.map(k => KEYWORDS[k]?.label).filter(Boolean).join(", ") + ".");
  if (card.ability) {
    const label = TRIGGER_LABEL[card.ability.trigger] || "";
    bits.push(`${label} ${describeEffect(card.ability)}`.trim());
  }
  return bits.join(" ");
}

// --- Catalog ---------------------------------------------------------------

export function buildCatalog(goobers = []) {
  const cards = {};
  for (const card of ORIGINALS) cards[card.id] = card;
  for (const card of TREATS) cards[card.id] = card;
  for (const goober of goobers) {
    if (!goober || !goober.id) continue;
    const card = cardFromGoober(goober);
    cards[card.id] = card;
  }
  for (const token of Object.values(TOKENS)) cards[token.id] = token.type === "spell" ? token : { ...token, text: describeMinion(token) };
  return cards;
}

export function collectibleIds(catalog) {
  return Object.values(catalog).filter(card => !card.token).map(card => card.id);
}

export function isCollectible(catalog, id) {
  return Boolean(catalog[id] && !catalog[id].token);
}

// Deck validation shared by client and server.
export function validateDeck(catalog, deckIds) {
  if (!Array.isArray(deckIds)) return { ok: false, error: "Deck must be a list of cards." };
  if (deckIds.length !== DECK_SIZE) return { ok: false, error: `Decks need exactly ${DECK_SIZE} cards.` };
  const counts = {};
  for (const id of deckIds) {
    const card = catalog[id];
    if (!card || card.token) return { ok: false, error: "Deck contains an unknown card." };
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > MAX_COPIES[card.rarity]) return { ok: false, error: `Too many copies of ${card.name}.` };
  }
  return { ok: true };
}

// Target number of cards at each cost (7 = 7+), so decks always have early plays.
export const CURVE_TARGET = { 1: 3, 2: 5, 3: 4, 4: 3, 5: 2, 6: 2, 7: 1 };

// A sensible deck from whatever the catalog has (used for AI opponents and starter decks).
export function autoDeck(catalog, ownedCounts = null, rng = Math.random) {
  const pool = [];
  for (const card of Object.values(catalog)) {
    if (card.token) continue;
    const owned = ownedCounts ? Math.min(ownedCounts[card.id] || 0, MAX_COPIES[card.rarity]) : MAX_COPIES[card.rarity];
    for (let i = 0; i < owned; i++) pool.push({ card, score: RARITY_BONUS[card.rarity] * 2 + (card.type === "minion" ? 1.5 : 0) + rng() * 3 });
  }
  pool.sort((a, b) => b.score - a.score);
  const deck = [];
  const used = new Set();
  const bucket = card => Math.min(7, Math.max(1, card.cost));
  // Fill each cost slot with the best cards available at that cost.
  for (const [cost, want] of Object.entries(CURVE_TARGET)) {
    let got = 0;
    for (let i = 0; i < pool.length && got < want; i++) {
      if (used.has(i) || bucket(pool[i].card) !== Number(cost)) continue;
      used.add(i); deck.push(pool[i].card); got++;
    }
  }
  // Top up with the cheapest leftovers so gaps never make the deck top-heavy.
  const rest = pool.map((entry, i) => ({ ...entry, i })).filter(entry => !used.has(entry.i)).sort((a, b) => a.card.cost - b.card.cost || b.score - a.score);
  while (deck.length < DECK_SIZE && rest.length) deck.push(rest.shift().card);
  return deck.slice(0, DECK_SIZE).map(card => card.id).sort((a, b) => catalog[a].cost - catalog[b].cost || catalog[a].name.localeCompare(catalog[b].name));
}
