// Goober Cards rules engine.
// Pure and deterministic (seeded RNG stored in state) so the same code runs
// in the browser for solo games and in the worker for online rooms.
import { TOKENS, HERO_POWER } from "./cards.js";

export const STARTING_HP = 25;
export const MAX_MANA = 10;
export const STARTING_MANA = 2;
export const MULLIGAN_MAX = 4;
export const BOARD_LIMIT = 6;
export const HAND_LIMIT = 10;

const heroUid = idx => `h${idx}`;
const other = idx => (idx === 0 ? 1 : 0);

// --- RNG -------------------------------------------------------------------
function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randomInt(state, max) { return Math.floor(nextRandom(state) * max); }
function shuffleInPlace(state, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// --- Setup -----------------------------------------------------------------
export function createGame({ decks, names = ["Player 1", "Player 2"], seed = Date.now(), firstPlayer = null }) {
  const state = {
    version: 1,
    rng: seed >>> 0,
    uid: 0,
    turn: 0,
    active: 0,
    winner: null,
    over: false,
    log: [],
    events: [],
    history: [],
    players: [0, 1].map(idx => ({
      name: names[idx] || `Player ${idx + 1}`,
      hero: { uid: heroUid(idx), hp: STARTING_HP, maxHp: STARTING_HP, armor: 0 },
      mana: 0,
      maxMana: 0,
      deck: [],
      hand: [],
      board: [],
      fatigue: 0,
      mulliganDone: false,
      powerUsed: false,
      conceded: false
    }))
  };
  for (const idx of [0, 1]) {
    const p = state.players[idx];
    p.deck = (decks[idx] || []).map(entry => {
      const card = typeof entry === "string" ? { id: entry } : entry;
      return { uid: `c${++state.uid}`, id: card.id, shiny: Boolean(card.shiny) };
    });
    shuffleInPlace(state, p.deck);
  }
  state.active = firstPlayer === 0 || firstPlayer === 1 ? firstPlayer : randomInt(state, 2);
  const second = other(state.active);
  for (let i = 0; i < 3; i++) drawCard(state, state.active, true);
  for (let i = 0; i < 4; i++) drawCard(state, second, true);
  addToHand(state, second, { uid: `c${++state.uid}`, id: "token-crumb", shiny: false });
  log(state, `${state.players[state.active].name} goes first. ${state.players[second].name} gets Bonus Aura.`);
  startTurn(state);
  state.events = [];
  return state;
}

// --- Helpers ---------------------------------------------------------------
function log(state, text, side = null) {
  state.log.push({ turn: state.turn, text, side });
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
}
function emit(state, event) { state.events.push(event); }

export function findCharacter(state, uid) {
  for (const idx of [0, 1]) {
    const p = state.players[idx];
    if (p.hero.uid === uid) return { kind: "hero", owner: idx, entity: p.hero };
    const minion = p.board.find(m => m.uid === uid);
    if (minion) return { kind: "minion", owner: idx, entity: minion };
  }
  return null;
}

function hasKw(minion, kw) { return Array.isArray(minion.keywords) && minion.keywords.includes(kw); }
function removeKw(minion, kw) { minion.keywords = (minion.keywords || []).filter(k => k !== kw); }
function addKw(minion, kw) { if (!hasKw(minion, kw)) minion.keywords = [...(minion.keywords || []), kw]; }

function addToHand(state, idx, cardInst) {
  const p = state.players[idx];
  if (p.hand.length >= HAND_LIMIT) {
    emit(state, { t: "burn", player: idx, id: cardInst.id });
    log(state, `${p.name}'s hand is full. A card got yeeted into the void.`, idx);
    return false;
  }
  p.hand.push(cardInst);
  return true;
}

function drawCard(state, idx, silent = false) {
  const p = state.players[idx];
  const card = p.deck.shift();
  if (!card) {
    p.fatigue += 1;
    emit(state, { t: "fatigue", player: idx, amount: p.fatigue });
    log(state, `${p.name} is out of cards and takes ${p.fatigue} burnout damage.`, idx);
    damageCharacter(state, p.hero.uid, p.fatigue, null);
    return;
  }
  if (addToHand(state, idx, card) && !silent) emit(state, { t: "draw", player: idx, uid: card.uid });
}

function summonMinion(state, catalog, idx, cardId, { shiny = false, position = null } = {}) {
  const p = state.players[idx];
  if (p.board.length >= BOARD_LIMIT) return null;
  const def = catalog[cardId] || TOKENS[cardId];
  if (!def) return null;
  const minion = {
    uid: `m${++state.uid}`,
    id: cardId,
    shiny,
    attack: def.attack,
    health: def.health,
    maxHealth: def.health,
    keywords: [...(def.keywords || [])],
    sick: true,
    attacksLeft: 0,
    frozen: false,
    frozenAt: 0
  };
  if (hasKw(minion, "zoomies")) { minion.sick = false; minion.attacksLeft = hasKw(minion, "doubleWag") ? 2 : 1; }
  const at = position === null || position === undefined ? p.board.length : Math.max(0, Math.min(p.board.length, Number(position) || 0));
  p.board.splice(at, 0, minion);
  emit(state, { t: "summon", uid: minion.uid, player: idx });
  return minion;
}

function healCharacter(state, uid, amount) {
  const found = findCharacter(state, uid);
  if (!found || amount <= 0) return 0;
  const e = found.entity;
  const max = found.kind === "hero" ? e.maxHp : e.maxHealth;
  const cur = found.kind === "hero" ? e.hp : e.health;
  const healed = Math.min(amount, max - cur);
  if (healed <= 0) return 0;
  if (found.kind === "hero") e.hp += healed; else e.health += healed;
  emit(state, { t: "heal", uid, amount: healed });
  return healed;
}

// Returns damage actually dealt.
function damageCharacter(state, uid, amount, source) {
  const found = findCharacter(state, uid);
  if (!found || amount <= 0) return 0;
  const e = found.entity;
  let dealt = 0;
  if (found.kind === "minion") {
    if (hasKw(e, "fluffy")) {
      removeKw(e, "fluffy");
      emit(state, { t: "shield", uid });
      return 0;
    }
    e.health -= amount;
    dealt = amount;
    if (source && source.kind === "minion" && hasKw(source.entity, "bitey") && e.health > 0) e.health = 0;
  } else {
    const absorbed = Math.min(e.armor, amount);
    e.armor -= absorbed;
    e.hp -= amount - absorbed;
    dealt = amount;
  }
  emit(state, { t: "damage", uid, amount });
  if (found.kind === "minion" && source && source.kind === "minion" && hasKw(source.entity, "leftOnRead")) freeze(state, uid);
  if (source && source.kind === "minion" && hasKw(source.entity, "lifesnack")) {
    healCharacter(state, heroUid(source.owner), dealt);
  }
  return dealt;
}

function aliveEnemies(state, idx, { includeHero = true, includeSneaky = true } = {}) {
  const foe = state.players[other(idx)];
  const list = foe.board.filter(m => m.health > 0 && (includeSneaky || !hasKw(m, "sneaky"))).map(m => m.uid);
  if (includeHero) list.push(foe.hero.uid);
  return list;
}

// --- Targeting --------------------------------------------------------------
// Chosen-target kinds a player picks during play.
const CHOSEN = new Set(["any", "enemy", "enemyMinion", "friendly", "friendlyMinion", "anyMinion"]);

export function validTargetsFor(state, idx, targetKind, sourceUid = null) {
  const me = state.players[idx], foe = state.players[other(idx)];
  const enemyMinions = foe.board.filter(m => !hasKw(m, "sneaky")).map(m => m.uid);
  const friendlyMinions = me.board.filter(m => m.uid !== sourceUid).map(m => m.uid);
  switch (targetKind) {
    case "any": return [...enemyMinions, foe.hero.uid, ...friendlyMinions, me.hero.uid];
    case "enemy": return [...enemyMinions, foe.hero.uid];
    case "enemyMinion": return enemyMinions;
    case "friendly": return [...friendlyMinions, me.hero.uid];
    case "friendlyMinion": return friendlyMinions;
    case "anyMinion": return [...enemyMinions, ...friendlyMinions];
    default: return [];
  }
}

function effectOf(def) { return def.type === "spell" ? def.effect : def.ability?.trigger === "battlecry" ? def.ability : null; }

// Describe what playing a hand card needs: { playable, reason, targets|null }
export function playInfo(state, catalog, idx, handUid) {
  const p = state.players[idx];
  const inst = p.hand.find(c => c.uid === handUid);
  if (!inst) return { playable: false, reason: "Card not in hand." };
  const def = catalog[inst.id];
  if (!def) return { playable: false, reason: "Unknown card." };
  if (state.over) return { playable: false, reason: "Game over." };
  if (state.active !== idx) return { playable: false, reason: "Not your turn." };
  if (def.cost > p.mana) return { playable: false, reason: "Not enough Aura." };
  if (def.type === "minion" && p.board.length >= BOARD_LIMIT) return { playable: false, reason: "Your side is full. No more room." };
  const effect = effectOf(def);
  if (effect && CHOSEN.has(effect.target)) {
    const targets = validTargetsFor(state, idx, effect.target);
    if (!targets.length) {
      if (def.type === "spell") return { playable: false, reason: "No valid targets." };
      return { playable: true, targets: null, def };
    }
    return { playable: true, targets, def };
  }
  return { playable: true, targets: null, def };
}

export function attackTargets(state, idx, attackerUid) {
  const me = state.players[idx], foe = state.players[other(idx)];
  const attacker = me.board.find(m => m.uid === attackerUid);
  if (!attacker || !canAttack(state, idx, attackerUid)) return [];
  const visible = foe.board.filter(m => !hasKw(m, "sneaky"));
  const guards = visible.filter(m => hasKw(m, "guard"));
  if (guards.length) return guards.map(m => m.uid);
  return [...visible.map(m => m.uid), foe.hero.uid];
}

export function canAttack(state, idx, uid) {
  if (state.over || state.active !== idx) return false;
  const m = state.players[idx].board.find(x => x.uid === uid);
  return Boolean(m && m.attack > 0 && !m.sick && !m.frozen && m.attacksLeft > 0);
}

export function powerTargets(state, idx) {
  const p = state.players[idx];
  if (state.over || state.active !== idx || p.powerUsed || p.mana < HERO_POWER.cost) return [];
  return validTargetsFor(state, idx, "enemy");
}

// --- Effects ----------------------------------------------------------------
function resolveEffect(state, catalog, idx, effect, { targetUid = null, source = null, selfUid = null } = {}) {
  if (!effect) return;
  const me = state.players[idx];
  const foe = state.players[other(idx)];
  const sourceChar = source || null;

  const targetsFor = kind => {
    switch (kind) {
      case "allEnemyMinions": return foe.board.map(m => m.uid);
      case "allEnemies": return [...foe.board.map(m => m.uid), foe.hero.uid];
      case "allFriendlyMinions": return me.board.map(m => m.uid);
      case "friendlyHero": return [me.hero.uid];
      case "self": return selfUid ? [selfUid] : [];
      case "randomEnemy": {
        const pool = aliveEnemies(state, idx);
        return pool.length ? [pool[randomInt(state, pool.length)]] : [];
      }
      case "randomFriendlyMinion": {
        const pool = me.board.filter(m => m.health > 0 && m.uid !== selfUid).map(m => m.uid);
        return pool.length ? [pool[randomInt(state, pool.length)]] : [];
      }
      default: return targetUid ? [targetUid] : [];
    }
  };

  switch (effect.type) {
    case "damage": {
      for (const uid of targetsFor(effect.target)) {
        damageCharacter(state, uid, effect.amount, sourceChar);
        if (effect.freeze) freeze(state, uid);
      }
      break;
    }
    case "freeze": {
      for (const uid of targetsFor(effect.target)) {
        if (effect.damage) damageCharacter(state, uid, effect.damage, sourceChar);
        freeze(state, uid);
      }
      break;
    }
    case "heal": for (const uid of targetsFor(effect.target)) healCharacter(state, uid, effect.amount); break;
    case "silence": for (const uid of targetsFor(effect.target)) silence(state, uid); break;
    case "draw": for (let i = 0; i < effect.amount; i++) drawCard(state, idx); break;
    case "buff": {
      for (const uid of targetsFor(effect.target)) {
        const found = findCharacter(state, uid);
        if (!found || found.kind !== "minion") continue;
        let atk = effect.attack || 0, hp = effect.health || 0;
        if (effect.perFriend) { const n = me.board.filter(m => m.uid !== uid).length; atk = n; hp = n; }
        found.entity.attack += atk;
        found.entity.health += hp;
        found.entity.maxHealth += hp;
        if (effect.keyword) {
          addKw(found.entity, effect.keyword);
          if (effect.keyword === "zoomies" && found.entity.sick) {
            found.entity.sick = false;
            found.entity.attacksLeft = hasKw(found.entity, "doubleWag") ? 2 : 1;
          }
        }
        if (atk || hp || effect.keyword) emit(state, { t: "buff", uid, attack: atk, health: hp });
      }
      break;
    }
    case "summon": {
      const selfIndex = selfUid ? me.board.findIndex(m => m.uid === selfUid) : -1;
      for (let i = 0; i < effect.count; i++) summonMinion(state, catalog, idx, effect.token, { position: selfIndex >= 0 ? selfIndex + 1 + i : null });
      break;
    }
    case "armor": me.hero.armor += effect.amount; emit(state, { t: "armor", player: idx, amount: effect.amount }); break;
    case "mana": me.mana = Math.min(MAX_MANA, me.mana + effect.amount); break;
    default: break;
  }
  if (effect.heal) healCharacter(state, me.hero.uid, effect.heal);
  if (effect.summon) for (let i = 0; i < (effect.summonCount || 1); i++) summonMinion(state, catalog, idx, effect.summon);
  if (effect.draw) for (let i = 0; i < effect.draw; i++) drawCard(state, idx);
}

function freeze(state, uid) {
  const found = findCharacter(state, uid);
  if (!found || found.kind !== "minion" || found.entity.health <= 0) return;
  found.entity.frozen = true;
  found.entity.frozenAt = state.turn;
  emit(state, { t: "freeze", uid });
}

// Shadowban: strip keywords, abilities and Muted. Stats (including buffs) stay.
function silence(state, uid) {
  const found = findCharacter(state, uid);
  if (!found || found.kind !== "minion" || found.entity.health <= 0) return;
  const m = found.entity;
  m.keywords = [];
  m.silenced = true;
  m.frozen = false;
  m.attacksLeft = Math.min(m.attacksLeft, 1);
  emit(state, { t: "silence", uid });
}

// A minion's triggered ability, unless it has been Shadowbanned.
const abilityOf = (catalog, m) => (m.silenced ? null : catalog[m.id]?.ability || null);

// Remove dead minions, fire Last Bark effects, check for a winner.
function cleanup(state, catalog) {
  for (let guard = 0; guard < 20; guard++) {
    const dead = [];
    for (const idx of [0, 1]) {
      const p = state.players[idx];
      p.board.forEach((m, position) => { if (m.health <= 0) dead.push({ idx, minion: m, position }); });
      p.board = p.board.filter(m => m.health > 0);
    }
    if (!dead.length) break;
    for (const { idx, minion } of dead) {
      emit(state, { t: "death", uid: minion.uid, player: idx });
      const ability = abilityOf(catalog, minion);
      if (ability?.trigger === "lastBark") {
        log(state, `${catalog[minion.id].name}'s Last Words!`, idx);
        resolveEffect(state, catalog, idx, ability, { source: { kind: "minion", owner: idx, entity: minion } });
      }
    }
  }
  checkWinner(state);
}

function checkWinner(state) {
  if (state.over) return;
  const dead0 = state.players[0].hero.hp <= 0 || state.players[0].conceded;
  const dead1 = state.players[1].hero.hp <= 0 || state.players[1].conceded;
  if (!dead0 && !dead1) return;
  state.over = true;
  state.winner = dead0 && dead1 ? "draw" : dead0 ? 1 : 0;
  emit(state, { t: "gameOver", winner: state.winner });
  log(state, state.winner === "draw" ? "It's a draw. Nobody wins. Awkward." : `${state.players[state.winner].name} wins. W.`);
}

// --- Turn flow ----------------------------------------------------------------
function startTurn(state) {
  state.turn += 1;
  const idx = state.active;
  const p = state.players[idx];
  p.maxMana = Math.min(MAX_MANA, p.maxMana ? p.maxMana + 1 : STARTING_MANA);
  p.mana = p.maxMana;
  p.powerUsed = false;
  for (const m of p.board) {
    m.sick = false;
    m.attacksLeft = hasKw(m, "doubleWag") ? 2 : 1;
  }
  emit(state, { t: "turn", player: idx });
  drawCard(state, idx);
}

function endTurn(state, catalog) {
  const idx = state.active;
  const p = state.players[idx];
  for (const m of [...p.board]) {
    const ability = abilityOf(catalog, m);
    if (ability?.trigger === "endTurn" && m.health > 0) resolveEffect(state, catalog, idx, ability, { selfUid: m.uid, source: { kind: "minion", owner: idx, entity: m } });
  }
  for (const m of p.board) {
    if (m.frozen && m.frozenAt < state.turn) { m.frozen = false; emit(state, { t: "thaw", uid: m.uid }); }
  }
  cleanup(state, catalog);
  if (state.over) return;
  state.active = other(idx);
  startTurn(state);
  cleanup(state, catalog);
}

// --- Actions ------------------------------------------------------------------
// action: {type:"play", uid, target?, position?} | {type:"attack", uid, target} |
//         {type:"power", target} | {type:"end"} | {type:"concede"} |
//         {type:"mulligan", uids} (once, before your first move of the game; during the
//         first turn both players may swap, so whoever goes second can too)
export function applyAction(state, catalog, idx, action) {
  state.events = [];
  if (!action || typeof action !== "object") return { ok: false, error: "Invalid action." };
  if (action.type === "concede") {
    if (state.over) return { ok: false, error: "Game over." };
    state.players[idx].conceded = true;
    log(state, `${state.players[idx].name} rage quit.`, idx);
    checkWinner(state);
    return { ok: true, events: state.events };
  }
  if (state.over) return { ok: false, error: "The game is over." };
  const openingSwap = action.type === "mulligan" && state.turn === 1;
  if (state.active !== idx && !openingSwap) return { ok: false, error: "It's not your turn." };
  const me = state.players[idx];

  if (action.type === "mulligan") {
    if (me.mulliganDone) return { ok: false, error: "You already swapped your starting hand." };
    me.mulliganDone = true;
    const picks = new Set((Array.isArray(action.uids) ? action.uids : []).slice(0, MULLIGAN_MAX));
    const back = me.hand.filter(c => picks.has(c.uid) && c.id !== "token-crumb");
    if (!back.length) return { ok: true, events: state.events };
    me.hand = me.hand.filter(c => !back.includes(c));
    me.deck.push(...back);
    shuffleInPlace(state, me.deck);
    // Draw replacements that aren't the cards you just threw back, when possible.
    for (let i = 0; i < back.length; i++) {
      const at = me.deck.findIndex(c => !back.includes(c));
      const [card] = me.deck.splice(at >= 0 ? at : 0, 1);
      me.hand.push(card);
      emit(state, { t: "draw", player: idx, uid: card.uid });
    }
    log(state, `${me.name} swapped ${back.length} card${back.length === 1 ? "" : "s"}.`, idx);
    return { ok: true, events: state.events };
  }
  me.mulliganDone = true;

  if (action.type === "end") {
    log(state, `${me.name} ended the turn.`, idx);
    endTurn(state, catalog);
    return { ok: true, events: state.events };
  }

  if (action.type === "play") {
    const info = playInfo(state, catalog, idx, action.uid);
    if (!info.playable) return { ok: false, error: info.reason };
    const def = info.def;
    let target = null;
    if (info.targets) {
      if (!info.targets.includes(action.target)) return { ok: false, error: "Choose a valid target." };
      target = action.target;
    }
    const handIndex = me.hand.findIndex(c => c.uid === action.uid);
    const inst = me.hand.splice(handIndex, 1)[0];
    me.mana -= def.cost;
    emit(state, { t: "play", player: idx, id: def.id, uid: inst.uid, shiny: inst.shiny });
    state.history = [...(state.history || []), { player: idx, id: def.id, shiny: inst.shiny, turn: state.turn }].slice(-8);
    if (def.type === "minion") {
      const minion = summonMinion(state, catalog, idx, def.id, { shiny: inst.shiny, position: action.position });
      log(state, `${me.name} played ${def.name}.`, idx);
      if (minion && def.ability?.trigger === "battlecry") {
        resolveEffect(state, catalog, idx, def.ability, { targetUid: target, selfUid: minion.uid, source: { kind: "minion", owner: idx, entity: minion } });
      }
    } else {
      log(state, `${me.name} used ${def.name}.`, idx);
      resolveEffect(state, catalog, idx, def.effect, { targetUid: target });
    }
    cleanup(state, catalog);
    return { ok: true, events: state.events };
  }

  if (action.type === "attack") {
    const targets = attackTargets(state, idx, action.uid);
    if (!targets.length) return { ok: false, error: "That Goober can't attack right now." };
    if (!targets.includes(action.target)) return { ok: false, error: "Pick a valid target. Tanks have to go first." };
    const attacker = me.board.find(m => m.uid === action.uid);
    const defender = findCharacter(state, action.target);
    attacker.attacksLeft -= 1;
    removeKw(attacker, "sneaky");
    emit(state, { t: "attack", from: attacker.uid, to: action.target });
    const aDef = catalog[attacker.id], dName = defender.kind === "hero" ? state.players[defender.owner].name : catalog[defender.entity.id]?.name;
    log(state, `${aDef?.name || "A Goober"} attacked ${dName}.`, idx);
    const attackerChar = { kind: "minion", owner: idx, entity: attacker };
    const defenderAttack = defender.kind === "minion" ? defender.entity.attack : 0;
    damageCharacter(state, action.target, attacker.attack, attackerChar);
    if (defender.kind === "minion" && defenderAttack > 0) damageCharacter(state, attacker.uid, defenderAttack, defender);
    cleanup(state, catalog);
    return { ok: true, events: state.events };
  }

  if (action.type === "power") {
    const targets = powerTargets(state, idx);
    if (!targets.length) return { ok: false, error: me.powerUsed ? "BARK FART is once per turn. Pace yourself." : "Not enough Aura." };
    if (!targets.includes(action.target)) return { ok: false, error: "Choose an enemy to BARK FART at." };
    me.mana -= HERO_POWER.cost;
    me.powerUsed = true;
    emit(state, { t: "power", player: idx, to: action.target });
    log(state, `${me.name} used BARK FART. 💨`, idx);
    damageCharacter(state, action.target, HERO_POWER.damage, null);
    cleanup(state, catalog);
    return { ok: true, events: state.events };
  }

  return { ok: false, error: "Unknown action." };
}

// Everything a player may do right now (used by the AI and for hints).
export function legalActions(state, catalog, idx) {
  if (state.over || state.active !== idx) return [];
  const actions = [];
  const me = state.players[idx];
  for (const inst of me.hand) {
    const info = playInfo(state, catalog, idx, inst.uid);
    if (!info.playable) continue;
    if (info.targets) for (const target of info.targets) actions.push({ type: "play", uid: inst.uid, target });
    else actions.push({ type: "play", uid: inst.uid });
  }
  for (const m of me.board) for (const target of attackTargets(state, idx, m.uid)) actions.push({ type: "attack", uid: m.uid, target });
  for (const target of powerTargets(state, idx)) actions.push({ type: "power", target });
  actions.push({ type: "end" });
  return actions;
}

// Hide the opponent's hand and both decks for a given viewer.
export function viewFor(state, viewer) {
  const view = JSON.parse(JSON.stringify(state));
  view.events = [];
  for (const idx of [0, 1]) {
    const p = view.players[idx];
    p.deckCount = p.deck.length;
    p.deck = [];
    p.handCount = p.hand.length;
    if (idx !== viewer) p.hand = p.hand.map(c => ({ uid: c.uid, hidden: true }));
  }
  delete view.rng;
  return view;
}

// Strip hidden card identities out of events sent to a viewer.
export function eventsFor(events, viewer) {
  return (events || []).map(e => (e.t === "draw" && e.player !== viewer ? { t: "draw", player: e.player } : e));
}
