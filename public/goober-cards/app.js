// Goober Cards app shell: menus, collection, packs, decks, and starting matches.
import { buildCatalog, collectibleIds, MAX_COPIES, DECK_SIZE, RARITIES, RARITY_LABEL, CATEGORIES, CATEGORY_STYLE, KEYWORDS, HERO_POWER, autoDeck, validateDeck } from "./cards.js";
import { createGame, STARTING_HP, BOARD_LIMIT } from "./engine.js";
import { AI_LEVELS } from "./ai.js";
import { SoloMatch } from "./battle.js";
import { OnlineMatch, createRoom } from "./online.js";
import * as store from "./collection.js";
import { $, $$, esc, sleep, cardHTML, cardBackHTML, toast, modal, confirmDialog, keywordGlossary, onLongPress } from "./ui.js";
import { sfx, setSoundEnabled, buzz } from "./sound.js";

const app = document.getElementById("app");
const GOOBER_CACHE_KEY = "gooberCardsGoobers";
let catalog = buildCatalog(readCachedGoobers());
let match = null;
let online = null;
const view = { collection: { rarity: "all", owned: "all", category: "all", search: "" }, builderTab: "deck", solo: { level: "goodboy" } };

const profile = () => store.loadProfile();
setSoundEnabled(profile().settings.sound);

// ------------------------------------------------------------------ catalog
function readCachedGoobers() {
  try { return JSON.parse(localStorage.getItem(GOOBER_CACHE_KEY) || "[]"); } catch { return []; }
}

async function refreshCatalog() {
  try {
    const res = await fetch("/api/goobers", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const goobers = await res.json();
    if (!Array.isArray(goobers)) return;
    try { localStorage.setItem(GOOBER_CACHE_KEY, JSON.stringify(goobers)); } catch { /* storage full */ }
    const before = collectibleIds(catalog).length;
    catalog = buildCatalog(goobers);
    if (collectibleIds(catalog).length !== before && !match && !online) route();
  } catch (error) {
    console.warn("Using cached Goobers:", error.message);
  }
}

function heroArt(id) {
  const card = catalog[id];
  return card?.art?.image || "/assets/original-goober.jpg";
}

// ------------------------------------------------------------------ router
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener("hashchange", () => route());

function route() {
  if (match || online?.battle) return;
  const [name, arg] = location.hash.replace(/^#/, "").split("/");
  document.body.classList.remove("in-battle");
  document.querySelectorAll(".modal, .opening").forEach(el => el.remove());
  document.body.style.overflow = "";
  window.scrollTo(0, 0);
  switch (name) {
    case "solo": return renderSolo();
    case "online": return renderOnline(arg);
    case "packs": return renderPacks();
    case "collection": return renderCollection();
    case "decks": return renderDecks();
    case "deck": return renderBuilder(arg);
    default: return renderHome();
  }
}

function topbar(title, back = "#home", right = "") {
  return `<div class="topbar"><a class="icon-btn" href="${back}" aria-label="Back">←</a><h2>${esc(title)}</h2>${right}<span class="pill coins-pill">🪙 ${profile().coins}</span></div>`;
}

// ------------------------------------------------------------------ home
function renderHome() {
  const p = profile();
  const ids = collectibleIds(catalog);
  const discovered = ids.filter(id => store.owned(id) > 0).length;
  const packCount = Object.values(p.packs).reduce((a, b) => a + b, 0);
  const newCount = Object.keys(p.newCards).filter(id => catalog[id]).length;
  const showcase = ids.map(id => catalog[id]).filter(c => c.type === "minion").sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity)).slice(0, 3);
  app.innerHTML = `
  <div class="screen home">
    <div class="home-top">
      <a class="icon-btn" href="/" aria-label="Back to The Big Goober Website">🏠</a>
      <div class="spacer"></div>
      <span class="pill coins-pill">🪙 ${p.coins}</span>
      <button class="icon-btn" data-settings aria-label="Settings">⚙️</button>
    </div>
    <div class="logo">
      <img src="/assets/original-goober.jpg" alt="">
      <h1>Goober Cards<small>Collect Goobers. Build decks. Bonk friends.</small></h1>
    </div>
    <section class="home-hero">
      <div>
        <h2>Ready to battle, ${esc(p.name || "Goober Fan")}?</h2>
        <p>${p.stats.wins} wins · ${p.stats.losses} losses${p.stats.streak > 1 ? ` · 🔥 ${p.stats.streak} win streak` : ""}</p>
        <div class="row"><a class="btn big primary" href="#solo">▶ Play</a><a class="btn blue" href="#online">🌐 Online</a></div>
      </div>
      <div class="fan">${showcase.map(c => cardHTML(c)).join("")}</div>
    </section>
    <div class="tiles">
      <a class="tile pink" href="#packs"><span class="ico">🎁</span><b>Open Packs</b><span>${packCount ? `${packCount} waiting!` : "Buy with coins"}</span>${packCount ? `<em class="badge">${packCount}</em>` : ""}</a>
      <a class="tile yellow" href="#collection"><span class="ico">📚</span><b>Collection</b><span>${discovered}/${ids.length} found</span>${newCount ? `<em class="badge">${newCount}</em>` : ""}</a>
      <a class="tile green" href="#decks"><span class="ico">🃏</span><b>My Decks</b><span>${p.decks.length} deck${p.decks.length === 1 ? "" : "s"}</span></a>
      <button class="tile blue" data-rules><span class="ico">📖</span><b>How to Play</b><span>Rules in 1 minute</span></button>
      <a class="tile orange" href="/#upload"><span class="ico">✏️</span><b>Draw a Goober</b><span>Uploads become new cards</span></a>
      <button class="tile white" data-hero><span class="ico">🖼️</span><b>My Portrait</b><span>Pick your hero art</span></button>
    </div>
    <div class="home-foot">
      <span class="muted">Collection is saved on this device.</span>
      <a href="/">← The Big Goober Website</a>
    </div>
  </div>`;
  $("[data-rules]", app).onclick = showRules;
  $("[data-settings]", app).onclick = showSettings;
  $("[data-hero]", app).onclick = pickPortrait;
  if (!p.name) askName();
  else maybeDaily();
}

function askName(then) {
  const m = modal(`<h2>Welcome to Goober Cards! 🐶</h2><p>Every Goober drawn on this site is a collectible card. Open packs, build a deck, and battle.</p><p>What should we call you?</p><input type="text" maxlength="20" placeholder="Your name" data-name><div class="actions"><button class="btn primary" data-save>Let's go!</button></div>`, { dismissable: false });
  const input = $("[data-name]", m.el);
  setTimeout(() => input.focus(), 50);
  const save = () => {
    profile().name = input.value.trim().slice(0, 20) || "Goober Fan";
    store.saveProfile();
    m.close();
    if (then) then();
    else {
      store.claimDaily();
      toast("You got 4 free Goober Packs to start! 🎁", "good");
      renderHome();
      if (!profile().tutorialSeen) showRules();
    }
  };
  $("[data-save]", m.el).onclick = save;
  input.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}

function maybeDaily() {
  const gift = store.claimDaily();
  if (!gift) return;
  sfx.coins();
  modal(`<div style="text-align:center"><div style="font-size:4rem">🎁</div><h2>Daily Gift!</h2><p>Here's a free Goober Pack for today. Come back tomorrow for another.</p><div class="actions" style="justify-content:center"><button class="btn" data-close>Later</button><a class="btn primary" href="#packs" data-close>Open it!</a></div></div>`, { onClose: () => renderHome() });
}

function showSettings() {
  const p = profile();
  const m = modal(`<h2>Settings</h2>
    <p><b>Name</b></p><input type="text" maxlength="20" value="${esc(p.name)}" data-name>
    <div class="row" style="margin-top:14px">
      <button class="btn small" data-sound>${p.settings.sound ? "🔊 Sound on" : "🔇 Sound off"}</button>
      <button class="btn small" data-haptics>${p.settings.haptics ? "📳 Buzz on" : "📴 Buzz off"}</button>
    </div>
    <p class="muted" style="color:#5a5160">Your cards, coins, and decks are saved in this browser. Clearing site data resets them.</p>
    <div class="actions"><button class="btn danger" data-reset>Reset progress</button><button class="btn primary" data-close>Done</button></div>`, {
    onClose: () => { p.name = $("[data-name]", m.el).value.trim().slice(0, 20) || p.name; store.saveProfile(); renderHome(); }
  });
  $("[data-sound]", m.el).onclick = e => { e.target.textContent = toggleSound() ? "🔊 Sound on" : "🔇 Sound off"; };
  $("[data-haptics]", m.el).onclick = e => { p.settings.haptics = !p.settings.haptics; store.saveProfile(); e.target.textContent = p.settings.haptics ? "📳 Buzz on" : "📴 Buzz off"; };
  $("[data-reset]", m.el).onclick = async () => {
    if (!(await confirmDialog("Reset everything?", "All cards, coins, and decks on this device will be erased.", { yes: "Erase", danger: true }))) return;
    try { localStorage.removeItem("gooberCardsProfile.v2"); } catch { /* ignore */ }
    location.hash = "";
    location.reload();
  };
}

function toggleSound() {
  const p = profile();
  p.settings.sound = !p.settings.sound;
  setSoundEnabled(p.settings.sound);
  store.saveProfile();
  return p.settings.sound;
}

function pickPortrait() {
  const options = collectibleIds(catalog).map(id => catalog[id]).filter(c => c.type === "minion" && c.art?.image && store.owned(c.id) > 0);
  const current = profile().hero || "original-goober";
  const m = modal(`<h2>Pick your portrait</h2><p>Any Goober you own can be your hero.</p>
    <div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(80px,1fr))">${options.map(c => `<button class="grid-cell" data-pick="${esc(c.id)}" style="border-radius:50%;overflow:hidden;aspect-ratio:1;border:4px solid ${c.id === current ? "#ffd34d" : "#1f1f1f"};background:#fff url('${esc(c.art.image)}') center/cover"><span style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:.7rem;font-weight:800;padding:2px">${esc(c.name)}</span></button>`).join("") || "<p>Open some packs to unlock portraits!</p>"}</div>
    <div class="actions"><button class="btn primary" data-close>Done</button></div>`);
  m.el.addEventListener("click", e => {
    const id = e.target.closest("[data-pick]")?.dataset.pick;
    if (!id) return;
    profile().hero = id;
    store.saveProfile();
    toast(`${catalog[id].name} is your hero now!`, "good");
    m.close();
  });
}

export function showRules() {
  profile().tutorialSeen = true;
  store.saveProfile();
  modal(`<div class="rules">
    <h2>How to Play</h2>
    <p>Knock your opponent's hero from <b>${STARTING_HP}</b> Health to 0. Take turns playing cards and bonking with your Goobers.</p>
    <h3>🦴 Bones</h3>
    <ul><li>Each card costs Bones (top-left number).</li><li>You get 1 Bone on turn one, +1 each turn, up to 10. They refill every turn.</li><li>The player who goes second gets <b>The Crumb</b>: a free extra Bone once.</li></ul>
    <h3>🐶 Goobers (minions)</h3>
    <ul><li>Tap a card, then tap the table to play it (or drag it up).</li><li>Goobers need a turn to wake up before attacking.</li><li>Tap one of your glowing Goobers, then tap an enemy to attack. Or drag an arrow!</li><li>When Goobers fight, both deal their Attack (yellow) to each other's Health (red).</li><li>Up to ${BOARD_LIMIT} Goobers fit on your side of the table.</li></ul>
    <h3>🦴 Treats (spells)</h3>
    <ul><li>One-time effects. Some need you to pick a target.</li></ul>
    <h3>📢 ${HERO_POWER.name}</h3>
    <ul><li>Once per turn, spend ${HERO_POWER.cost} Bones to deal 1 damage to an enemy.</li></ul>
    <h3>✨ Keywords</h3>
    <ul>${Object.values(KEYWORDS).map(k => `<li>${k.icon} <b>${k.label}:</b> ${k.text}</li>`).join("")}
    <li>📣 <b>Arrival:</b> Happens when you play it.</li><li>☠️ <b>Last Bark:</b> Happens when it's defeated.</li></ul>
    <h3>🎁 Collecting</h3>
    <ul><li>Win games to earn coins. Buy packs, find rare and ✨shiny✨ Goobers.</li><li>Every Goober uploaded to the site becomes a card with its own stats and rarity.</li><li>Decks have exactly ${DECK_SIZE} cards: max 2 copies of a card (1 for Legendaries).</li><li>Press and hold any card to read it up close.</li></ul>
    <div class="actions"><button class="btn primary" data-close>Got it!</button></div></div>`);
}

// ------------------------------------------------------------------ deck picker
function deckPickerHTML(selectedId) {
  const decks = store.getDecks();
  if (!decks.length) return `<p class="muted">You'll use an automatic Starter Deck. Build your own in <a href="#decks" style="color:var(--yellow)">My Decks</a>.</p>`;
  return `<div class="deck-pick">${decks.map(d => {
    const bad = store.deckProblems(d, catalog).length > 0;
    return `<button class="deck-chip ${d.id === selectedId ? "selected" : ""}" data-deck="${esc(d.id)}"><b>${esc(d.name)}</b><small>${bad ? "⚠️ Needs fixing" : `${d.cards.length} cards`}</small></button>`;
  }).join("")}</div>`;
}

function bindDeckPicker(root, onPick) {
  root.addEventListener("click", e => {
    const id = e.target.closest("[data-deck]")?.dataset.deck;
    if (!id) return;
    const deck = store.getDeck(id);
    if (store.deckProblems(deck, catalog).length) { toast("That deck needs fixing first.", "bad"); go(`#deck/${id}`); return; }
    profile().activeDeck = id;
    store.saveProfile();
    onPick?.(id);
  });
}

// ------------------------------------------------------------------ solo
const AI_ART = { pup: "/assets/Party Goober.jpg", goodboy: "/assets/cowboy-goober.jpg", biggoober: "/assets/spider-goober.jpg" };

function renderSolo() {
  const level = view.solo.level;
  app.innerHTML = `<div class="screen">
    ${topbar("Solo Battle")}
    <span class="field-label">Choose your opponent</span>
    <div class="choice-list three">${Object.entries(AI_LEVELS).map(([key, l]) => `
      <button class="choice ${key === level ? "selected" : ""}" data-level="${key}"><img src="${AI_ART[key]}" alt=""><div><b>${l.name}</b><small>${l.blurb}</small><br><small>🪙 Win: +${l.reward}</small></div></button>`).join("")}
    </div>
    <span class="field-label">Your deck</span>
    ${deckPickerHTML(profile().activeDeck)}
    <div class="sticky-go"><button class="btn big primary" data-start>⚔️ Battle!</button></div>
  </div>`;
  $$("[data-level]", app).forEach(b => b.onclick = () => { view.solo.level = b.dataset.level; renderSolo(); });
  bindDeckPicker(app.firstElementChild, () => renderSolo());
  $("[data-start]", app).onclick = () => startSolo(view.solo.level);
}

function aiDeck(level) {
  if (level === "biggoober") return autoDeck(catalog, null, () => Math.random() * 0.5 + 0.5);
  if (level === "pup") {
    const counts = {};
    for (const id of collectibleIds(catalog)) counts[id] = catalog[id].rarity === "common" || catalog[id].rarity === "rare" ? 2 : 0;
    const deck = autoDeck(catalog, counts);
    return deck.length === DECK_SIZE ? deck : autoDeck(catalog);
  }
  return autoDeck(catalog);
}

function startSolo(level) {
  const { deck, entries } = store.playableDeck(catalog);
  const oppDeck = aiDeck(level).map(id => ({ id, shiny: level === "biggoober" && Math.random() < 0.15 }));
  const state = createGame({ decks: [entries, oppDeck], names: [profile().name || "You", AI_LEVELS[level].name], seed: (Math.random() * 2 ** 32) >>> 0 });
  history.pushState(null, "", "#battle");
  match = new SoloMatch({
    catalog, state, level,
    heroArt: [heroArt(profile().hero), AI_ART[level]],
    showRules, toggleSound, soundOn: () => profile().settings.sound,
    onExit: () => exitMatch(),
    onEnd: ({ won, draw }) => {
      const reward = won ? AI_LEVELS[level].reward : draw ? 20 : 15;
      const result = store.recordResult({ won, reward });
      showResult({ won, draw, coins: result.coins, firstWin: result.firstWin, again: () => { exitMatch(false); startSolo(level); }, deckName: deck.name });
    }
  });
}

function exitMatch(goHome = true) {
  match?.destroy();
  match = null;
  if (online) { online.close(); online = null; }
  document.querySelectorAll(".modal").forEach(el => el.remove());
  if (goHome) { history.replaceState(null, "", "#home"); route(); }
}

window.addEventListener("popstate", async () => {
  if (!match && !online?.battle) return;
  const state = match?.state || null;
  if (state && state.over) { exitMatch(); return; }
  history.pushState(null, "", "#battle");
  if (await confirmDialog("Leave the battle?", "Leaving now counts as giving up.", { yes: "Leave", danger: true })) {
    if (match) await match.act({ type: "concede" });
    else online?.send({ type: "action", action: { type: "concede" } });
    exitMatch();
  }
});

function showResult({ won, draw, coins, firstWin, again, onlineRoom }) {
  if (won) { sfx.win(); buzz([60, 40, 60]); } else sfx.lose();
  const title = draw ? "Draw!" : won ? "Victory!" : "Defeat";
  const m = modal(`<div class="result ${won ? "win" : "lose"}">
      <h2>${title}</h2>
      <div class="portrait" style="background-image:url('${esc(heroArt(profile().hero))}')"></div>
      ${coins ? `<div class="reward">🪙 +${coins}</div>` : ""}
      ${firstWin ? `<p><b>First win of the day bonus included!</b></p>` : ""}
      <p>${won ? "Your Goobers were magnificent." : "Even the best loaves crumble sometimes."}</p>
      <div class="actions" style="justify-content:center">
        <button class="btn" data-home>Home</button>
        ${profile().coins >= 100 || Object.values(profile().packs).some(n => n > 0) ? `<button class="btn pink" data-packs>🎁 Packs</button>` : ""}
        <button class="btn primary" data-again>${onlineRoom ? "Rematch" : "Play again"}</button>
      </div></div>`, { className: `result ${won ? "win" : "lose"}`, dismissable: false });
  $("[data-home]", m.el).onclick = () => { m.close(); exitMatch(); };
  const packs = $("[data-packs]", m.el);
  if (packs) packs.onclick = () => { m.close(); exitMatch(false); history.replaceState(null, "", "#packs"); route(); };
  $("[data-again]", m.el).onclick = () => { m.close(); again(); };
  if (coins) sfx.coins();
}

// ------------------------------------------------------------------ online
function renderOnline(code) {
  const p = profile();
  app.innerHTML = `<div class="screen">
    ${topbar("Online Battle")}
    <p class="muted">Play a friend on another phone or tablet. Create a room and share the code.</p>
    <span class="field-label">Your deck</span>
    ${deckPickerHTML(p.activeDeck)}
    <div class="online-card">
      <button class="btn big primary" data-create>✨ Create Room</button>
      <div class="muted" style="text-align:center;font-weight:800">or join a friend</div>
      <div class="row"><input data-code maxlength="8" placeholder="CODE" value="${esc(code || "")}" autocomplete="off" autocapitalize="characters" style="flex:1;min-width:140px"><button class="btn blue" data-join>Join</button></div>
    </div>
    <div data-lobby></div>
  </div>`;
  bindDeckPicker(app.firstElementChild, () => renderOnline($("[data-code]", app).value));
  $("[data-create]", app).onclick = async e => {
    e.target.disabled = true;
    try { const { roomCode } = await createRoom(); joinOnline(roomCode); }
    catch (error) { toast(error.message, "bad"); e.target.disabled = false; }
  };
  $("[data-join]", app).onclick = () => {
    const c = $("[data-code]", app).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { toast("Enter the room code from your friend.", "bad"); return; }
    joinOnline(c);
  };
  if (code && code.length >= 4) joinOnline(code.toUpperCase());
}

function joinOnline(code) {
  if (online) online.close();
  const { entries } = store.playableDeck(catalog);
  history.replaceState(null, "", `#online/${code}`);
  const lobby = $("[data-lobby]", app);
  const link = `${location.origin}/goober-cards/#online/${code}`;
  online = new OnlineMatch({
    code, name: profile().name || "Goober Fan", heroId: profile().hero || "original-goober", deck: entries, catalog,
    heroArtFor: heroArt, showRules, toggleSound, soundOn: () => profile().settings.sound,
    onExit: () => exitMatch(),
    onLobby: (room, seat, status) => {
      if (status === "over") { if (room.rematch?.[seat === 0 ? 1 : 0] && !room.rematch?.[seat]) toast(`${room.seats[seat === 0 ? 1 : 0]?.name || "Your opponent"} wants a rematch!`, "good"); return; }
      if (online?.battle && status !== "rematch") return;
      if (status === "full" || status === "disconnected") { online?.close(); online = null; if (lobby.isConnected) lobby.innerHTML = `<p class="muted">${status === "full" ? "That room already has two players." : "Couldn't reach the room."}</p>`; return; }
      if (status === "rematch") {
        const other = room.seats[seat === 0 ? 1 : 0];
        const statusEl = $("[data-status]", app);
        if (statusEl) statusEl.textContent = other?.connected ? "Waiting for your opponent to say yes…" : "Your opponent left the room.";
        return;
      }
      if (!lobby.isConnected) return;
      lobby.innerHTML = `<div class="online-card" style="border-style:solid">
        <div style="text-align:center;font-weight:800">Room code</div>
        <div class="code-box">${esc(room.code)}</div>
        <div class="row" style="justify-content:center"><button class="btn small" data-share>📤 Share invite</button><button class="btn small" data-copy>📋 Copy link</button></div>
        <div class="seat-list">${[0, 1].map(i => { const s = room.seats[i]; return `<div class="seat"><span class="dot ${s?.connected ? "on" : ""}"></span>${s ? esc(s.name) : "Waiting for a friend…"}${i === seat ? " (you)" : ""}${s?.ready ? " ✅" : ""}</div>`; }).join("")}</div>
        <div class="row" style="justify-content:center"><div class="spinner"></div><span class="muted">The battle starts when both players join.</span></div>
      </div>`;
      $("[data-share]", lobby).onclick = async () => {
        if (navigator.share) { try { await navigator.share({ title: "Goober Cards", text: `Battle me in Goober Cards! Room ${room.code}`, url: link }); } catch { /* cancelled */ } }
        else { await copyText(link); }
      };
      $("[data-copy]", lobby).onclick = () => copyText(link);
    },
    onEnd: ({ won, draw }) => {
      const result = store.recordResult({ won, reward: won ? 100 : draw ? 30 : 30 });
      showResult({
        won, draw, coins: result.coins, firstWin: result.firstWin, onlineRoom: true,
        again: () => { const { entries: fresh } = store.playableDeck(catalog); online?.rematch(fresh); renderRematchWait(code); }
      });
    }
  });
}

function renderRematchWait(code) {
  history.replaceState(null, "", "#home");
  app.innerHTML = `<div class="screen">
    <div class="topbar"><h2>Rematch</h2><span class="pill coins-pill">🪙 ${profile().coins}</span></div>
    <div class="online-card" style="border-style:solid;text-align:center">
      <div class="code-box">${esc(code)}</div>
      <div class="row" style="justify-content:center"><div class="spinner"></div><span class="muted" data-status>Waiting for your opponent to say yes…</span></div>
      <button class="btn" data-leave>Leave room</button>
    </div></div>`;
  $("[data-leave]", app).onclick = () => exitMatch();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Link copied!", "good"); }
  catch { prompt("Copy this link:", text); }
}

// ------------------------------------------------------------------ packs
function renderPacks() {
  const p = profile();
  const gooberCount = collectibleIds(catalog).filter(id => catalog[id].gooberId).length;
  app.innerHTML = `<div class="screen">
    ${topbar("Packs")}
    <div class="pack-grid">${Object.values(store.PACKS).map(pack => {
      const locked = pack.onlyGoobers && gooberCount < 3;
      const n = p.packs[pack.id] || 0;
      return `<div class="pack-tile">
        <div class="pack-art" style="--pc:${pack.color}"><img src="/assets/original-goober.jpg" alt=""><div class="label">${esc(pack.name)}</div></div>
        <div><h3>${esc(pack.name)}</h3><p>${esc(pack.blurb)}</p>
          <div class="row">
            <button class="btn ${n ? "primary" : ""}" data-open="${pack.id}" ${n && !locked ? "" : "disabled"}>Open${n ? ` (${n})` : ""}</button>
            <button class="btn small" data-buy="${pack.id}" ${locked ? "disabled" : ""}>🪙 ${pack.price}</button>
          </div>
          ${locked ? `<p>Needs more uploaded Goobers first!</p>` : ""}
        </div></div>`;
    }).join("")}</div>
    <div class="pity">🌟 Legendary guaranteed within <b>${store.PITY_LIMIT - p.pity}</b> pack${store.PITY_LIMIT - p.pity === 1 ? "" : "s"}<div class="bar"><i style="width:${(p.pity / store.PITY_LIMIT) * 100}%"></i></div></div>
    <p class="muted">Earn coins by winning battles (+50 bonus for your first win each day). Extra copies you can't use can be recycled for coins in your Collection.</p>
  </div>`;
  $$("[data-buy]", app).forEach(b => b.onclick = () => {
    const res = store.buyPack(b.dataset.buy);
    if (!res.ok) { toast(res.error, "bad"); sfx.error(); return; }
    sfx.coins();
    renderPacks();
  });
  $$("[data-open]", app).forEach(b => b.onclick = () => openPackFlow(b.dataset.open));
}

function openPackFlow(type) {
  const pack = store.PACKS[type];
  const el = document.createElement("div");
  el.className = "opening";
  el.innerHTML = `<div class="title">${esc(pack.name)}</div><div class="stage"><div class="rays"></div><div class="pack-art" style="--pc:${pack.color}"><img src="/assets/original-goober.jpg" alt=""><div class="label">Tap to open!</div></div></div><div class="actions"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
  const art = $(".pack-art", el);
  let opened = false;
  const close = () => { el.remove(); document.body.style.overflow = ""; renderPacks(); };
  art.onclick = async () => {
    if (opened) return;
    opened = true;
    const res = store.openPack(type, catalog);
    if (!res.ok) { toast(res.error, "bad"); close(); return; }
    sfx.packShake(); buzz(20);
    art.classList.add("shake");
    await sleep(500);
    sfx.packOpen(); buzz(50);
    art.classList.remove("shake");
    art.classList.add("burst");
    await sleep(420);
    showPulls(el, res.cards, type, close);
  };
}

function showPulls(el, pulls, type, close) {
  const stage = $(".stage", el);
  const order = [...pulls].sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity));
  stage.innerHTML = `<div class="rays"></div><div class="pull-grid">${order.map((pull, i) => `
    <div class="flip ${pull.rarity}" data-i="${i}" style="animation-delay:${i * 90}ms">
      <div class="inner"><div class="face back">${cardBackHTML()}</div><div class="face front">${cardHTML(catalog[pull.id], { shiny: pull.shiny })}</div></div>
      ${pull.isNew ? `<span class="tag-new">NEW!</span>` : ""}
    </div>`).join("")}</div>`;
  $(".title", el).textContent = "Tap each card to flip it!";
  const actions = $(".actions", el);
  let flipped = 0;
  const reveal = flip => {
    if (flip.classList.contains("flipped")) return;
    flip.classList.add("flipped");
    const pull = order[Number(flip.dataset.i)];
    sfx.flip(pull.rarity);
    if (pull.rarity === "legendary" || pull.shiny) {
      const flash = document.createElement("div");
      flash.className = "legend-flash";
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 900);
      buzz([30, 30, 80]);
    }
    flipped += 1;
    if (flipped === order.length) done();
  };
  const done = () => {
    const left = profile().packs[type] || 0;
    const best = order[order.length - 1];
    $(".title", el).textContent = best.rarity === "legendary" ? "LEGENDARY! 🌟" : best.rarity === "epic" ? "Epic pull! 💜" : "Nice pack!";
    actions.innerHTML = `<button class="btn" data-done>Done</button>${left ? `<button class="btn primary" data-more>Open another (${left})</button>` : ""}`;
    $("[data-done]", actions).onclick = close;
    const more = $("[data-more]", actions);
    if (more) more.onclick = () => { el.remove(); openPackFlow(type); };
  };
  stage.addEventListener("click", e => { const flip = e.target.closest(".flip"); if (flip) reveal(flip); });
  actions.innerHTML = `<button class="btn" data-all>Flip all</button>`;
  $("[data-all]", actions).onclick = async () => { for (const f of $$(".flip", stage)) { reveal(f); await sleep(180); } };
}

// ------------------------------------------------------------------ collection
function filteredCards(filters, { ownedOnly = false } = {}) {
  const q = filters.search.trim().toLowerCase();
  return collectibleIds(catalog).map(id => catalog[id]).filter(card => {
    if (filters.rarity !== "all" && card.rarity !== filters.rarity) return false;
    if (filters.category !== "all") {
      if (filters.category === "treat" ? card.type !== "spell" : card.category !== filters.category) return false;
    }
    const n = store.owned(card.id);
    if ((ownedOnly || filters.owned === "owned") && !n) return false;
    if (filters.owned === "missing" && n) return false;
    if (q && !`${card.name} ${card.text} ${card.category}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => a.cost - b.cost || RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.name.localeCompare(b.name));
}

function filterBarHTML(f, { showOwned = true } = {}) {
  const cats = ["all", "treat", ...CATEGORIES];
  return `<div class="filters">
    <input type="search" placeholder="Search cards…" value="${esc(f.search)}" data-search>
    <div class="chips">${["all", ...RARITIES].map(r => `<button class="chip ${r} ${f.rarity === r ? "on" : ""}" data-rarity="${r}">${r === "all" ? "All" : RARITY_LABEL[r]}</button>`).join("")}
    ${showOwned ? ["all", "owned", "missing"].map(o => `<button class="chip ${f.owned === o ? "on" : ""}" data-owned="${o}">${{ all: "Everything", owned: "Owned", missing: "Missing" }[o]}</button>`).join("") : ""}</div>
    <div class="chips">${cats.map(c => `<button class="chip ${f.category === c ? "on" : ""}" data-cat="${c}">${c === "all" ? "All types" : c === "treat" ? "🦴 Treats" : `${CATEGORY_STYLE[c].icon} ${c}`}</button>`).join("")}</div>
  </div>`;
}

function bindFilters(root, f, rerender) {
  const search = $("[data-search]", root);
  let t = null;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { f.search = search.value; rerender(true); }, 200); });
  root.addEventListener("click", e => {
    const r = e.target.closest("[data-rarity]")?.dataset.rarity;
    const o = e.target.closest("[data-owned]")?.dataset.owned;
    const c = e.target.closest("[data-cat]")?.dataset.cat;
    if (r) f.rarity = r; else if (o) f.owned = o; else if (c) f.category = c; else return;
    rerender(false);
  });
}

function renderCollection() {
  const f = view.collection;
  const ids = collectibleIds(catalog);
  const discovered = ids.filter(id => store.owned(id) > 0).length;
  const shinies = ids.filter(id => store.ownedShiny(id) > 0).length;
  const extras = ids.reduce((sum, id) => sum + store.extrasOf(id, catalog) * store.RECYCLE_VALUE[catalog[id].rarity], 0);
  app.innerHTML = `<div class="screen">
    ${topbar("Collection")}
    <div class="progress-line"><span class="pill">📚 ${discovered}/${ids.length} found</span><span class="pill">✨ ${shinies} shiny</span>${extras ? `<button class="btn small" data-recycle>♻️ Recycle extras (+${extras})</button>` : ""}</div>
    ${filterBarHTML(f)}
    <div class="card-grid" data-grid></div>
  </div>`;
  const fillGrid = () => {
    const cards = filteredCards(f);
    const newCards = profile().newCards;
    $("[data-grid]", app).innerHTML = cards.length ? cards.map(card => {
      const n = store.owned(card.id), s = store.ownedShiny(card.id);
      return `<button class="grid-cell" data-card="${esc(card.id)}">${cardHTML(card, { shiny: s > 0, extraClass: n ? "" : "locked" })}${n ? `<span class="count">×${n}${s ? ` ✨${s}` : ""}</span>` : `<span class="count">🪙 ${store.CRAFT_COST[card.rarity]}</span>`}${newCards[card.id] ? `<span class="new">NEW</span>` : ""}</button>`;
    }).join("") : `<div class="empty-note">No cards match those filters.</div>`;
  };
  fillGrid();
  bindFilters(app.firstElementChild, f, keepFocus => {
    if (keepFocus) fillGrid();
    else { const y = window.scrollY; renderCollection(); window.scrollTo(0, y); }
  });
  const recycle = $("[data-recycle]", app);
  if (recycle) recycle.onclick = async () => {
    if (!(await confirmDialog("Recycle extras?", "Copies beyond what a deck can use (2, or 1 for Legendaries) turn into coins. Shinies are kept when possible.", { yes: "Recycle" }))) return;
    const res = store.recycleExtras(catalog);
    sfx.coins();
    toast(`Recycled ${res.count} cards for ${res.coins} coins!`, "good");
    renderCollection();
  };
  $("[data-grid]", app).addEventListener("click", e => {
    const id = e.target.closest("[data-card]")?.dataset.card;
    if (id) showCardDetail(id, () => { const y = window.scrollY; renderCollection(); window.scrollTo(0, y); });
  });
}

function showCardDetail(id, refresh) {
  const card = catalog[id];
  const n = store.owned(id), s = store.ownedShiny(id);
  store.markSeen(id);
  const canCraft = n < MAX_COPIES[card.rarity];
  const cost = store.CRAFT_COST[card.rarity];
  const m = modal(`<div class="inspect">${cardHTML(card, { shiny: s > 0 })}
    <div class="details">
      <p><b>${RARITY_LABEL[card.rarity]}</b> · ${card.type === "spell" ? "Treat" : `${CATEGORY_STYLE[card.category]?.icon || ""} ${esc(card.category)} Goober`} · You own <b>${n}</b>${s ? ` (✨${s} shiny)` : ""}</p>
      ${card.flavor ? `<p><i>${esc(card.flavor)}</i></p>` : ""}
      ${keywordGlossary(card.keywords, card)}
      <div class="row" style="margin-top:10px">
        ${canCraft ? `<button class="btn small primary" data-craft>🔨 Craft (🪙 ${cost})</button>` : ""}
        ${card.type === "minion" && card.art?.image && n ? `<button class="btn small" data-portrait>🖼️ Use as portrait</button>` : ""}
      </div>
    </div>
    <button class="btn primary" data-close>Close</button></div>`, { bare: true, onClose: refresh });
  const craft = $("[data-craft]", m.el);
  if (craft) craft.onclick = () => {
    const res = store.craftCard(id, catalog);
    if (!res.ok) { toast(res.error, "bad"); sfx.error(); return; }
    sfx.flip(card.rarity);
    toast(`Crafted ${card.name}!`, "good");
    m.close();
  };
  const portrait = $("[data-portrait]", m.el);
  if (portrait) portrait.onclick = () => { profile().hero = id; store.saveProfile(); toast(`${card.name} is your hero now!`, "good"); };
}

// ------------------------------------------------------------------ decks
function deckCover(deck) {
  const cards = deck.cards.map(id => catalog[id]).filter(Boolean).sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || b.cost - a.cost);
  return cards.find(c => c.art?.image) || cards[0] || null;
}

function renderDecks() {
  const p = profile();
  const decks = store.getDecks();
  app.innerHTML = `<div class="screen">
    ${topbar("My Decks")}
    <div class="deck-list">
      ${decks.map(d => {
        const problems = store.deckProblems(d, catalog);
        const cover = deckCover(d);
        return `<div class="deck-tile ${d.id === p.activeDeck ? "active" : ""}">
          <div class="cover" style="${cover?.art?.image ? `background-image:url('${esc(cover.art.image)}')` : ""}">${cover?.art?.image ? "" : "🃏"}</div>
          <div><b>${esc(d.name)}</b><small>${problems.length ? `⚠️ ${esc(problems[0])}` : `${d.cards.length} cards · ready`}${d.id === p.activeDeck ? " · ⭐ in use" : ""}</small>
            <div class="row"><a class="btn small" href="#deck/${esc(d.id)}">✏️ Edit</a>${d.id !== p.activeDeck && !problems.length ? `<button class="btn small go" data-use="${esc(d.id)}">Use</button>` : ""}</div>
          </div></div>`;
      }).join("")}
      ${decks.length < store.MAX_DECKS ? `<button class="deck-tile new" data-new><b>＋ New deck</b></button>` : ""}
    </div>
    ${decks.length ? "" : `<p class="muted">No decks yet. Make one, or just hit Play and we'll build a Starter Deck for you.</p>`}
  </div>`;
  $$("[data-use]", app).forEach(b => b.onclick = () => { p.activeDeck = b.dataset.use; store.saveProfile(); renderDecks(); });
  const add = $("[data-new]", app);
  if (add) add.onclick = () => {
    const deck = store.createDeck(catalog, `Deck ${decks.length + 1}`, []);
    if (deck) go(`#deck/${deck.id}`);
  };
}

function renderBuilder(id) {
  const deck = store.getDeck(id);
  if (!deck) { go("#decks"); return; }
  const f = view.deckFilters || (view.deckFilters = { rarity: "all", owned: "owned", category: "all", search: "" });
  const counts = {};
  for (const cid of deck.cards) counts[cid] = (counts[cid] || 0) + 1;
  const curve = Array.from({ length: 8 }, (_, i) => deck.cards.filter(cid => catalog[cid] && Math.min(7, catalog[cid].cost) === i).length);
  const maxCurve = Math.max(1, ...curve);
  const problems = store.deckProblems(deck, catalog);
  const tab = view.builderTab;
  const rows = Object.entries(counts).map(([cid, n]) => ({ card: catalog[cid], id: cid, n })).sort((a, b) => (a.card?.cost ?? 99) - (b.card?.cost ?? 99) || (a.card?.name || "").localeCompare(b.card?.name || ""));
  app.innerHTML = `<div class="screen">
    <div class="topbar"><a class="icon-btn" href="#decks" aria-label="Back">←</a><input class="name-input" value="${esc(deck.name)}" maxlength="24" data-name aria-label="Deck name"><span class="pill ${deck.cards.length === DECK_SIZE ? "" : "coins-pill"}">${deck.cards.length}/${DECK_SIZE}</span></div>
    <div class="builder split">
      <div class="builder-head">
        <div class="curve" title="Bone curve">${curve.map((n, i) => `<div><span>${n || ""}</span><i style="height:${(n / maxCurve) * 70}%"></i><span>${i === 7 ? "7+" : i}</span></div>`).join("")}</div>
        <div class="row">
          <button class="btn small" data-auto>✨ Auto-fill</button>
          <button class="btn small" data-clear>🧹 Clear</button>
          <button class="btn small danger" data-delete>🗑️ Delete</button>
          ${problems.length ? `<span class="muted">⚠️ ${esc(problems[0])}</span>` : `<span class="muted">✅ Ready to battle!</span>`}
        </div>
        <div class="tabs"><button class="${tab === "deck" ? "on" : ""}" data-tab="deck">In deck (${deck.cards.length})</button><button class="${tab === "add" ? "on" : ""}" data-tab="add">Add cards</button></div>
      </div>
      <div class="pane deck" ${tab === "deck" ? "" : "hidden"}>
        <div class="deck-rows">${rows.length ? rows.map(r => {
          const bad = !r.card || r.n > store.owned(r.id);
          return `<button class="deck-row ${r.card?.rarity || ""} ${bad ? "bad" : ""}" data-remove="${esc(r.id)}"><span class="c">${r.card?.cost ?? "?"}</span><span class="n">${esc(r.card?.name || "Missing card")}</span><span class="x">${r.n > 1 ? `×${r.n}` : r.card?.rarity === "legendary" ? "★" : ""}</span>${r.card?.art?.image ? `<span class="bg" style="background-image:url('${esc(r.card.art.image)}')"></span>` : ""}</button>`;
        }).join("") : `<div class="empty-note">Empty deck. Tap cards in "Add cards" or hit Auto-fill.</div>`}</div>
        <p class="muted" style="font-size:.85rem">Tap a row to remove one copy.</p>
      </div>
      <div class="pane add" ${tab === "add" ? "" : "hidden"}>
        ${filterBarHTML(f)}
        <div class="card-grid" data-grid></div>
      </div>
    </div>
  </div>`;
  const fillGrid = () => {
    const cards = filteredCards(f);
    $("[data-grid]", app).innerHTML = cards.length ? cards.map(card => {
      const n = store.owned(card.id), inDeck = counts[card.id] || 0;
      const max = Math.min(n, MAX_COPIES[card.rarity]);
      return `<button class="grid-cell ${inDeck >= max ? "maxed" : ""}" data-add="${esc(card.id)}">${cardHTML(card, { shiny: store.ownedShiny(card.id) > 0, extraClass: n ? "" : "locked" })}${inDeck ? `<span class="in-deck">${inDeck}/${max}</span>` : ""}<span class="count">${n ? `own ×${n}` : "not owned"}</span></button>`;
    }).join("") : `<div class="empty-note">No cards match. Try "Everything" to see cards you can craft.</div>`;
  };
  fillGrid();
  const save = () => { store.saveDeck(deck); };
  const rerender = () => { const y = window.scrollY; renderBuilder(id); window.scrollTo(0, y); };
  $("[data-name]", app).addEventListener("change", e => { deck.name = e.target.value.trim().slice(0, 24) || deck.name; save(); });
  $$("[data-tab]", app).forEach(b => b.onclick = () => { view.builderTab = b.dataset.tab; rerender(); });
  bindFilters($(".pane.add", app), f, keepFocus => (keepFocus ? fillGrid() : rerender()));
  $("[data-auto]", app).onclick = () => {
    const owned = store.ownedCounts();
    const remaining = { ...owned };
    for (const cid of deck.cards) remaining[cid] = (remaining[cid] || 0) - 1;
    const extra = autoDeck(catalog, Object.fromEntries(Object.entries(remaining).map(([k, v]) => [k, Math.max(0, Math.min(v, MAX_COPIES[catalog[k]?.rarity || "common"] - (counts[k] || 0)))])));
    const filled = [...deck.cards];
    for (const cid of extra) { if (filled.length >= DECK_SIZE) break; filled.push(cid); }
    deck.cards = filled.filter(cid => catalog[cid]).sort((a, b) => catalog[a].cost - catalog[b].cost);
    save();
    if (deck.cards.length < DECK_SIZE) toast("Not enough cards to fill it. Open more packs!", "bad");
    rerender();
  };
  $("[data-clear]", app).onclick = async () => { if (await confirmDialog("Clear deck?", "Remove every card from this deck?", { yes: "Clear" })) { deck.cards = []; save(); rerender(); } };
  $("[data-delete]", app).onclick = async () => {
    if (!(await confirmDialog("Delete deck?", `Delete "${deck.name}" forever?`, { yes: "Delete", danger: true }))) return;
    store.deleteDeck(deck.id);
    go("#decks");
  };
  app.querySelector(".pane.deck").addEventListener("click", e => {
    const rid = e.target.closest("[data-remove]")?.dataset.remove;
    if (!rid) return;
    const i = deck.cards.indexOf(rid);
    if (i >= 0) deck.cards.splice(i, 1);
    sfx.tap();
    save();
    rerender();
  });
  const grid = $("[data-grid]", app);
  onLongPress(grid, "[data-add]", el => showCardDetail(el.dataset.add, rerender));
  grid.addEventListener("click", e => {
    const aid = e.target.closest("[data-add]")?.dataset.add;
    if (!aid) return;
    const card = catalog[aid];
    const n = store.owned(aid), inDeck = counts[aid] || 0;
    if (!n) { showCardDetail(aid, rerender); return; }
    if (deck.cards.length >= DECK_SIZE) { toast(`Decks are ${DECK_SIZE} cards. Remove one first.`, "bad"); sfx.error(); return; }
    if (inDeck >= Math.min(n, MAX_COPIES[card.rarity])) { toast(inDeck >= MAX_COPIES[card.rarity] ? `Max ${MAX_COPIES[card.rarity]} ${card.rarity === "legendary" ? "copy" : "copies"} per deck.` : `You only own ${n}.`, "bad"); sfx.error(); return; }
    deck.cards.push(aid);
    deck.cards.sort((a, b) => (catalog[a]?.cost ?? 99) - (catalog[b]?.cost ?? 99));
    sfx.play();
    save();
    if (deck.cards.length === DECK_SIZE && validateDeck(catalog, deck.cards).ok) toast("Deck complete! ✅", "good");
    rerender();
  });
}

// ------------------------------------------------------------------ boot
function boot() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) { history.replaceState(null, "", `${location.pathname}#online/${room.toUpperCase()}`); }
  if (location.hash === "#battle") history.replaceState(null, "", "#home");
  route();
  refreshCatalog();
  document.addEventListener("pointerdown", () => { /* unlock audio on first touch */ }, { once: true });
}

boot();
