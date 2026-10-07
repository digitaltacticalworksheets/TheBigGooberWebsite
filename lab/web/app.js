// HEXAVAST client. All rules run on the server; this file draws the board, animates
// what happened, plays sounds, keeps the move list, and sends actions.
import { geometry, pathOf } from "./board.js";
import { sfx, soundOn, setSound, unlockAudio } from "./sound.js";

const app = document.getElementById("app");
const NAMES = ["Gold", "Purple"];
const SYM = ["★", "◆"];
const TIMER_LABEL = { 0: "Off", 30: "30s", 60: "1 min", 120: "2 min" };
const SIZE_LABEL = { standard: "Standard", large: "Large" };
const SIZE_NOTE = { standard: "61 cells · 60 pieces", large: "91 cells · 90 pieces" };
const REASONS = {
  elimination: loser => `${loser} has no cells left.`,
  stuck: loser => `${loser} had no legal move.`,
  limit: () => "Move limit reached, so the board was scored.",
  concede: loser => `${loser} conceded.`
};
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = ms => new Promise(r => setTimeout(r, REDUCED ? Math.min(ms, 60) : ms));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = (() => { try { return localStorage.getItem("gooberCardsSession") || ""; } catch { return ""; } })();

const ui = {
  pick: { soloColor: "gold", soloTimer: "0", soloSize: "standard", roomColor: "gold", roomTimer: "60", roomSize: "standard" },
  error: "",
  code: null, ws: null, opened: false, failures: 0, leaving: false,
  room: null, game: null, events: [], queue: [], skew: 0,
  animating: false, frame: null, fx: null,
  sel: null, vast: null, pending: false, resultShown: null, turnSeen: null, lastTick: 0
};

// --- Geometry & drawing helpers ------------------------------------------------------
const SIZE = 40, SQ3 = Math.sqrt(3);
const geo = () => geometry(ui.game?.radius || 4);
const centre = (g, i) => ({ x: SIZE * SQ3 * (g.cells[i].q + g.cells[i].r / 2), y: SIZE * 1.5 * g.cells[i].r });
const hexPoints = ({ x, y }, radius = SIZE) => Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * (60 * k - 30);
  return `${(x + radius * Math.cos(a)).toFixed(1)},${(y + radius * Math.sin(a)).toFixed(1)}`;
}).join(" ");
function viewBox(g) {
  const pad = SIZE * 1.6;
  const w = SIZE * SQ3 * (2 * g.radius + 1) + pad * 2, h = SIZE * (3 * g.radius + 2) + pad * 2;
  return { w, h, attr: `${(-w / 2).toFixed(1)} ${(-h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}` };
}
// The board's outer plate: the hexagon through the six corner cells, pushed outwards.
function platePoints(g, grow) {
  const R = g.radius;
  return [[R, -R], [R, 0], [0, R], [-R, R], [-R, 0], [0, -R]].map(([q, r]) => {
    const x = SIZE * SQ3 * (q + r / 2), y = SIZE * 1.5 * r, d = Math.hypot(x, y) || 1;
    return `${(x + (x / d) * grow).toFixed(1)},${(y + (y / d) * grow).toFixed(1)}`;
  }).join(" ");
}
function pieceStack(p, height, owner, extraClass = "") {
  let out = `<g class="stack ${extraClass}"><polygon class="shadow" points="${hexPoints({ x: p.x + 2, y: p.y + (height - 1) * 2.2 + 4 }, SIZE * 0.68)}"/>`;
  for (let k = 0; k < height; k++) {
    const cy = p.y + (height - 1) * 2.2 - k * 4.4, top = k === height - 1;
    out += `<polygon class="piece p${owner} ${top ? "top" : "under"}" points="${hexPoints({ x: p.x, y: cy }, SIZE * 0.66)}"/>`;
    if (top) out += `<polygon class="rim p${owner}" points="${hexPoints({ x: p.x, y: cy }, SIZE * 0.5)}"/>`;
  }
  const top = p.y - (height - 1) * 2.2;
  out += `<text class="sym p${owner}" x="${p.x.toFixed(1)}" y="${(top - 8).toFixed(1)}" text-anchor="middle" font-size="11">${SYM[owner]}</text>`;
  out += `<text class="num p${owner}" x="${p.x.toFixed(1)}" y="${(top + 12).toFixed(1)}" text-anchor="middle" font-size="19">${height}</text>`;
  return `${out}</g>`;
}
const DEFS = `<defs>
  <linearGradient id="hxCell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c5a69"/><stop offset="1" stop-color="#454352"/></linearGradient>
  <linearGradient id="hxCellAlt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#53515f"/><stop offset="1" stop-color="#3e3c49"/></linearGradient>
  <linearGradient id="hxPlate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2733"/><stop offset="1" stop-color="#16141c"/></linearGradient>
  <linearGradient id="hxRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d77a"/><stop offset="0.5" stop-color="#8a5cd6"/><stop offset="1" stop-color="#e3b23c"/></linearGradient>
  <radialGradient id="hxGold" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff2bf"/><stop offset="0.45" stop-color="#efbf45"/><stop offset="1" stop-color="#a87812"/></radialGradient>
  <radialGradient id="hxPurple" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#e2ccff"/><stop offset="0.45" stop-color="#9558e6"/><stop offset="1" stop-color="#4a2386"/></radialGradient>
</defs>`;

function boardSVG() {
  const g = geo(), view = ui.frame || ui.game;
  if (!view) return "";
  const vb = viewBox(g), fx = ui.fx || {};
  const last = new Set();
  if (!ui.frame) for (const e of ui.events) {
    if (e.t === "spawn" || e.t === "grow") last.add(e.cell);
    if (e.t === "vast") { last.add(e.from); e.path.forEach(c => last.add(c)); }
  }
  const plan = ui.vast?.choice ? pathOf(g, ui.vast.from, ui.vast.choice.dir, ui.vast.drops.length) : [];
  const dests = (!ui.frame && ui.vast?.dests) || new Map();
  const interactive = myTurn();
  let cells = "";
  g.cells.forEach((c, i) => {
    const p = centre(g, i);
    const cls = ["cell", c.ring % 2 ? "alt" : "", interactive ? "tap" : "", ui.sel === i && !ui.frame ? "sel" : "",
      dests.has(i) && !ui.vast?.choice ? "dest" : "", plan.includes(i) ? "path" : "", last.has(i) ? "last" : "",
      fx.pop?.has(i) ? "pop" : "", fx.flip?.has(i) ? "flip" : "", fx.charge === i ? "charge" : "", fx.lift === i ? "lifted" : ""].filter(Boolean).join(" ");
    const height = view.h[i], owner = view.o[i];
    const label = height ? `${g.names[i]}: ${NAMES[owner]} stack of ${height}` : `${g.names[i]}: empty`;
    let extra = "";
    if (dests.has(i) && !ui.vast?.choice) extra = `<circle class="hint" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7"/>`;
    const at = plan.indexOf(i);
    if (at >= 0) extra = `<text class="drop" x="${(p.x + SIZE * 0.52).toFixed(1)}" y="${(p.y - SIZE * 0.42).toFixed(1)}" text-anchor="middle" font-size="16">+${ui.vast.drops[at]}</text>`;
    cells += `<g class="${cls}" data-i="${i}" role="button" aria-label="${label}"><title>${label}</title>
      <polygon class="face" points="${hexPoints(p)}"/><polygon class="bevel" points="${hexPoints(p, SIZE * 0.84)}"/>
      ${height ? pieceStack(p, height, owner) : ""}${extra}</g>`;
  });
  return `<svg class="board" viewBox="${vb.attr}" aria-label="Board">${DEFS}
    <polygon class="plate-glow" points="${platePoints(g, SIZE * 1.25)}"/>
    <polygon class="plate" points="${platePoints(g, SIZE * 1.2)}"/>
    <polygon class="plate-inner" points="${platePoints(g, SIZE * 0.95)}"/>
    ${cells}</svg>`;
}

// --- Lobby -------------------------------------------------------------------------
function seg(name, options, value) {
  return `<div class="seg" role="group">${options.map(([v, label]) => `<button type="button" data-seg="${name}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join("")}</div>`;
}
const colorOptions = [["gold", "Gold ★"], ["purple", "Purple ◆"], ["random", "Random"]];
const timerOptions = Object.entries(TIMER_LABEL);
const sizeOptions = Object.entries(SIZE_LABEL).map(([v, l]) => [v, `${l}<small>${SIZE_NOTE[v]}</small>`]);
const soundButton = () => `<button class="icon-btn" data-sound aria-label="${soundOn() ? "Mute sound" : "Turn sound on"}" title="Sound">${soundOn() ? "🔊" : "🔇"}</button>`;

function renderLobby() {
  const p = ui.pick;
  app.innerHTML = `<div class="lobby">
    <header class="hero">
      <div class="hero-logo"><img src="/lab/logo.png" alt=""></div>
      <div class="hero-text"><h1>HEXAVAST</h1><p>Stack. Slide. Ripple. Control the hexagon.</p></div>
      ${soundButton()}
    </header>
    ${token ? "" : `<p class="error">You're not logged in here. Log in on the main site, then reload this page.</p>`}
    <div class="lobby-grid">
      <section class="card">
        <h2><span class="tag gold">Solo</span> Play the NPC</h2>
        <label>Your colour ${seg("soloColor", colorOptions, p.soloColor)}</label>
        <label>Board ${seg("soloSize", sizeOptions, p.soloSize)}</label>
        <label>Move timer ${seg("soloTimer", timerOptions, p.soloTimer)}</label>
        <button class="btn gold big" data-start-solo>Start game</button>
      </section>
      <section class="card">
        <h2><span class="tag purple">Online</span> Play another admin</h2>
        <label>Your colour ${seg("roomColor", colorOptions, p.roomColor)}</label>
        <label>Board ${seg("roomSize", sizeOptions, p.roomSize)}</label>
        <label>Move timer ${seg("roomTimer", timerOptions, p.roomTimer)}</label>
        <button class="btn purple big" data-create>Create room</button>
        <div class="divider"><span>or join</span></div>
        <div class="row"><input class="code grow" data-code maxlength="8" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" data-join>Join</button></div>
      </section>
    </div>
    <p class="error" data-error>${esc(ui.error)}</p>
    <button class="btn ghost" data-rules>How to play</button>
  </div>`;
}

async function createRoom(mode) {
  const p = ui.pick, solo = mode === "solo";
  const body = { mode, color: solo ? p.soloColor : p.roomColor, timer: Number(solo ? p.soloTimer : p.roomTimer), size: solo ? p.soloSize : p.roomSize };
  ui.error = "";
  try {
    const res = await fetch("/api/lab/rooms", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't make a room.");
    enterRoom(data.code);
  } catch (error) {
    ui.error = error.message;
    sfx.error();
    renderLobby();
  }
}

// --- Connection ------------------------------------------------------------------------
function enterRoom(code) {
  ui.code = code.toUpperCase();
  ui.leaving = false;
  ui.opened = false;
  ui.failures = 0;
  history.replaceState(null, "", `#${ui.code}`);
  connect();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/lab/rooms/${ui.code}/socket?auth=${encodeURIComponent(token)}`);
  ui.ws = ws;
  ws.addEventListener("open", () => { ui.opened = true; ui.failures = 0; });
  ws.addEventListener("message", e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onMessage(msg);
  });
  ws.addEventListener("close", () => {
    if (ui.ws !== ws || ui.leaving) return;
    ui.failures += 1;
    if (!ui.opened && ui.failures >= 3) { leave(`Room ${ui.code} wasn't found.`); return; }
    if (ui.room) toast("Reconnecting…");
    setTimeout(() => { if (ui.ws === ws && !ui.leaving) connect(); }, Math.min(10000, 800 * 2 ** ui.failures));
  });
}

function send(msg) { if (ui.ws?.readyState === WebSocket.OPEN) ui.ws.send(JSON.stringify(msg)); }

function leave(error = "") {
  ui.leaving = true;
  try { ui.ws?.close(); } catch { /* closed */ }
  document.querySelectorAll(".modal").forEach(m => m.remove());
  Object.assign(ui, { ws: null, code: null, room: null, game: null, events: [], queue: [], sel: null, vast: null, pending: false, resultShown: null, frame: null, fx: null, error });
  history.replaceState(null, "", location.pathname);
  renderLobby();
}

function onMessage(msg) {
  if (msg.type === "state") { ui.queue.push(msg); drain(); }
  else if (msg.type === "options") {
    if (ui.vast && ui.vast.from === msg.from) { ui.vast.moves = msg.moves; buildGroups(); render(); }
  } else if (msg.type === "error") {
    ui.pending = false;
    sfx.error();
    toast(msg.message);
    render();
  }
}

// --- Playing states in order, animating each move ------------------------------------
async function drain() {
  if (ui.animating) return;
  ui.animating = true;
  try {
    while (ui.queue.length) {
      const msg = ui.queue.shift();
      const prev = ui.game;
      ui.skew = msg.room.now - Date.now();
      const sameGame = prev && msg.game && prev.seed === msg.game.seed && msg.game.ply >= prev.ply;
      if (sameGame && msg.events?.length) {
        ui.room = msg.room;
        await animate(prev, msg.events);
      }
      const turnChanged = !prev || !msg.game || msg.game.ply !== prev.ply || msg.game.over !== prev.over || prev.seed !== msg.game.seed;
      ui.room = msg.room;
      ui.game = msg.game;
      ui.events = msg.events || [];
      ui.frame = null;
      ui.fx = null;
      if (turnChanged) { ui.sel = null; ui.vast = null; ui.pending = false; }
      render();
    }
  } finally {
    ui.animating = false;
    render();
  }
}

// Replay the server's events on a copy of the previous board.
async function animate(prev, events) {
  const work = { h: prev.h.slice(), o: prev.o.slice(), radius: prev.radius };
  const mover = events.find(e => "player" in e)?.player;
  ui.frame = work;
  ui.fx = {};
  ui.sel = null;
  ui.vast = null;
  render();
  // Give the opponent's move a beat so it doesn't appear out of nowhere.
  if (mover !== undefined && mover !== ui.room.you) await sleep(ui.room.seats[mover]?.npc ? 550 : 250);
  const g = geo();
  for (const e of events) {
    if (e.t === "spawn") {
      work.h[e.cell] = 1; work.o[e.cell] = e.player;
      ui.fx = { pop: new Set([e.cell]) };
      sfx.spawn(); renderBoard(); await sleep(420);
    } else if (e.t === "grow") {
      work.h[e.cell] = e.height; work.o[e.cell] = e.player;
      ui.fx = { pop: new Set([e.cell]) };
      sfx.grow(e.height); renderBoard(); await sleep(420);
    } else if (e.t === "vast") {
      let carried = work.h[e.from];
      const owner = e.player;
      work.h[e.from] = 0; work.o[e.from] = -1;
      ui.fx = {};
      renderBoard();
      const floater = makeFloater(g, e.from, carried, owner);
      sfx.vast();
      await glide(floater, centre(g, e.from), centre(g, e.from), 140, true);
      let at = centre(g, e.from);
      for (let i = 0; i < e.path.length; i++) {
        const to = centre(g, e.path[i]);
        await glide(floater, at, to, 210);
        at = to;
        work.h[e.path[i]] += e.drops[i]; work.o[e.path[i]] = owner;
        carried -= e.drops[i];
        ui.fx = { pop: new Set([e.path[i]]) };
        renderBoard();
        sfx.drop(i);
        updateFloater(floater, carried, owner);
      }
      floater.remove();
      await sleep(240);
    } else if (e.t === "ripple") {
      ui.fx = { charge: e.cell };
      renderBoard();
      await sleep(260);
      sfx.ripple();
      rippleRing(g, e.cell);
      work.h[e.cell] = 0; work.o[e.cell] = -1;
      for (const c of e.flipped) work.o[c] = e.player;
      e.flipped.forEach((_, i) => sfx.flip(i));
      ui.fx = { flip: new Set(e.flipped) };
      renderBoard();
      await sleep(620);
    }
  }
}

function fxLayer() { return app.querySelector("svg.fx"); }
function makeFloater(g, cell, height, owner) {
  const layer = fxLayer();
  const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
  el.setAttribute("class", "floater");
  el.innerHTML = pieceStack({ x: 0, y: 0 }, height, owner);
  layer?.appendChild(el);
  const p = centre(g, cell);
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  return el;
}
function updateFloater(el, height, owner) {
  el.innerHTML = height > 0 ? pieceStack({ x: 0, y: 0 }, height, owner) : "";
}
function glide(el, from, to, ms, lift = false) {
  if (!el.isConnected) return sleep(ms);
  const a = `translate(${from.x}px, ${from.y}px) scale(${lift ? 1 : 1.14})`;
  const b = `translate(${to.x}px, ${to.y}px) scale(1.14)`;
  el.style.transform = b;
  if (REDUCED) return sleep(30);
  return el.animate([{ transform: a }, { transform: b }], { duration: ms, easing: lift ? "ease-out" : "cubic-bezier(.45,.05,.35,1)" }).finished.catch(() => {});
}
function rippleRing(g, cell) {
  const layer = fxLayer();
  if (!layer || REDUCED) return;
  const p = centre(g, cell);
  for (const [r, delay] of [[SIZE, 0], [SIZE * 0.6, 120]]) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    el.setAttribute("class", "ring");
    el.setAttribute("points", hexPoints({ x: 0, y: 0 }, r));
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    layer.appendChild(el);
    el.animate([
      { transform: `translate(${p.x}px, ${p.y}px) scale(0.5)`, opacity: 1 },
      { transform: `translate(${p.x}px, ${p.y}px) scale(3.2)`, opacity: 0 }
    ], { duration: 800, delay, easing: "ease-out", fill: "forwards" }).finished.then(() => el.remove()).catch(() => el.remove());
  }
}

// --- Game view -------------------------------------------------------------------------
const myTurn = () => ui.room?.phase === "playing" && ui.room.you >= 0 && ui.game && ui.game.toMove === ui.room.you && !ui.pending && !ui.animating;
const countOf = (view, p) => view ? view.o.reduce((n, o) => n + (o === p ? 1 : 0), 0) : 0;
const tallestOf = (view, p) => view ? view.h.reduce((m, h, i) => (view.o[i] === p ? Math.max(m, h) : m), 0) : 0;
const seatName = p => ui.room?.seats[p]?.name || NAMES[p];
const isDesktop = () => matchMedia("(min-width: 900px)").matches;

function renderBoard() {
  const host = app.querySelector(".board-host");
  if (host) host.innerHTML = boardSVG();
  else render();
}

function render() {
  if (!ui.room) { renderLobby(); return; }
  const { room, game } = ui;
  const view = ui.frame || game;
  const g = geo();
  const vb = viewBox(g);
  const cells = [0, 1].map(p => countOf(view, p));
  const total = cells[0] + cells[1];
  const players = [0, 1].map(p => {
    const seat = room.seats[p];
    const turn = room.phase === "playing" && game && game.toMove === p;
    return `<div class="player p${p} ${turn ? "turn" : ""}">
      <span class="disc" aria-hidden="true">${SYM[p]}</span>
      <span class="who"><b>${esc(seat ? seat.name : "Waiting…")}</b>${room.you === p ? `<em>you</em>` : ""}${seat?.npc ? `<em>NPC</em>` : ""}${seat && !seat.connected ? `<em class="off">offline</em>` : ""}</span>
      <span class="count">${cells[p]}<small>cells</small></span>
      <span class="sub">${NAMES[p]}${room.you === p ? " · you" : ""} · tallest ${tallestOf(view, p)}</span>
      ${turn && room.deadline ? `<span class="clock" data-clock></span>` : ""}
    </div>`;
  }).join("");
  const goldShare = total ? (100 * cells[0]) / total : 50;
  const body = room.phase === "waiting"
    ? `<section class="card waiting"><h2>Waiting for another admin</h2><div class="bigcode">${esc(room.code)}</div><p class="note">Share this code. They open this page and join with it.</p><button class="btn" data-copy>Copy code</button></section>`
    : `<div class="board-host">${boardSVG()}</div><svg class="fx" viewBox="${vb.attr}" aria-hidden="true"></svg>`;
  const tickerOpen = isDesktop() || ui.tickerOpen;
  app.innerHTML = `<div class="game">
    <header class="topbar">
      <span class="logo" aria-hidden="true"></span><span class="title">HEXAVAST</span>
      <span class="chip">${room.mode === "solo" ? "vs NPC" : `Room ${esc(room.code)}`}</span>
      <span class="chip hide-sm">${SIZE_LABEL[room.size] || "Standard"}</span>
      ${room.timer ? `<span class="chip hide-sm">⏱ ${TIMER_LABEL[room.timer]}</span>` : ""}
      <span class="spacer"></span>
      ${soundButton()}
      <button class="btn small ghost" data-rules aria-label="Rules"><span class="lg">Rules</span><span class="sm">?</span></button>
      ${room.phase === "playing" && room.you >= 0 ? `<button class="btn small danger" data-concede aria-label="Concede"><span class="lg">Concede</span><span class="sm">⚑</span></button>` : ""}
      <button class="btn small ghost" data-leave aria-label="Leave"><span class="lg">Leave</span><span class="sm">✕</span></button>
    </header>
    <aside class="side">
      <div class="players">${players}</div>
      <div class="territory" aria-label="Territory: Gold ${cells[0]}, Purple ${cells[1]}"><i class="g" style="width:${goldShare.toFixed(1)}%"></i><i class="p"></i></div>
      <div class="meta"><span>Supply <b>${view ? view.supply ?? game.supply : "—"}</b>${game ? ` / ${game.total || 60}` : ""}</span><span>Move <b>${game ? game.ply + 1 : 1}</b></span></div>
    </aside>
    <section class="board-wrap">${body}</section>
    <details class="ticker" ${tickerOpen ? "open" : ""}><summary><span>Moves</span><span class="last">${esc(lastMoveText())}</span></summary><ol>${tickerItems()}</ol></details>
  </div>
  <div class="actionbar"><div class="inner">${actionHTML()}</div></div>`;
  const list = app.querySelector(".ticker ol");
  if (list) list.scrollTop = list.scrollHeight;
  tickClock();
  if (room.phase === "over" && game && !ui.animating && ui.resultShown !== resultKey()) {
    ui.resultShown = resultKey();
    if (room.you >= 0) (game.winner === room.you ? sfx.win : game.winner === "draw" ? sfx.turn : sfx.lose)();
    setTimeout(() => showModal("result"), 350);
  }
  if (myTurn() && ui.turnSeen !== `${game.seed}:${game.ply}`) {
    ui.turnSeen = `${game.seed}:${game.ply}`;
    // Against the NPC it's always your move next, so the banner is only for online games.
    if (game.ply > 0 || room.mode === "online") { sfx.turn(); if (room.mode === "online") banner("Your move"); }
  }
}
const resultKey = () => `${ui.game.seed}:${ui.game.ply}`;

// --- Move list --------------------------------------------------------------------------
function describe(e, g) {
  const n = i => g.names[i] || "?";
  let text = "";
  if (e.k === "spawn") text = `Spawn ${n(e.c)}`;
  else if (e.k === "grow") text = `Grow ${n(e.c)} → ${e.h}`;
  else if (e.k === "vast") text = `Vast ${n(e.f)} → ${n(e.to)} (${e.dr.join("·")})`;
  else if (e.k === "concede") text = "Conceded";
  if (e.rp) text += e.rp.map(([c, f]) => ` · Ripple ${n(c)}${f ? `, flipped ${f}` : ""}`).join("");
  if (e.t) text += " · timed out";
  return text;
}
function tickerItems() {
  const t = ui.room?.ticker || [], g = geo();
  if (!t.length) return `<li class="empty">No moves yet.</li>`;
  return t.map(e => {
    const who = e.p >= 0 ? `<i class="pip p${e.p}">${SYM[e.p]}</i>${esc(seatName(e.p))}` : "";
    let html = `<li class="p${e.p}"><span class="n">${e.n}</span><span class="who">${who}</span><span class="what">${esc(describe(e, g))}</span></li>`;
    if (e.r) html += `<li class="end"><span class="what">${e.w === "draw" ? "Draw" : `${esc(seatName(e.w))} wins`} · ${esc(e.r)}</span></li>`;
    return html;
  }).join("");
}
function lastMoveText() {
  const t = ui.room?.ticker || [];
  if (!t.length) return "No moves yet";
  const e = t[t.length - 1];
  return `${e.n}. ${NAMES[e.p]}: ${describe(e, geo())}`;
}

// --- Action bar --------------------------------------------------------------------------
function actionHTML() {
  const { room, game } = ui;
  if (room.phase === "waiting") return `<div class="msg">Waiting for an opponent to join with code <b>${esc(room.code)}</b>.</div>`;
  if (!game) return "";
  if (room.phase === "over" && !ui.animating) {
    const waitingOther = room.mode === "online" && room.you >= 0 && room.rematch[room.you];
    return `<div class="msg">${winnerText()}</div><div class="row">${room.you >= 0 ? `<button class="btn gold" data-rematch ${waitingOther ? "disabled" : ""}>${waitingOther ? "Waiting for rematch…" : "Rematch"}</button>` : ""}<button class="btn" data-result>Result</button><button class="btn ghost" data-leave>Lobby</button></div>`;
  }
  if (ui.animating) {
    // While a move plays, ui.game is still the position before it, so toMove is the mover.
    const m = game.toMove;
    const who = m === room.you ? "Playing your move" : `${esc(seatName(m))}${room.seats[m]?.npc ? " (NPC)" : ""} is moving`;
    return `<div class="msg muted-msg"><span class="pulse p${m}"></span>${who}…</div>`;
  }
  if (room.you < 0) return `<div class="msg">Watching. ${NAMES[game.toMove]} to move.</div>`;
  if (ui.pending) return `<div class="msg muted-msg"><span class="pulse"></span>Sending…</div>`;
  if (game.toMove !== room.you) {
    const npc = room.seats[game.toMove]?.npc;
    return `<div class="msg">${esc(seatName(game.toMove))} (${NAMES[game.toMove]}) ${npc ? "is thinking…" : "to move."}${ui.sel !== null ? `<small>${cellInfo(ui.sel)}</small>` : ""}</div>`;
  }
  const me = room.you;
  if (ui.vast) {
    if (!ui.vast.moves) return `<div class="msg muted-msg"><span class="pulse"></span>Finding Vast Moves…</div>`;
    if (!ui.vast.moves.length) return `<div class="msg">This stack has no legal Vast Move.</div><div class="row"><button class="btn" data-cancel>Back</button></div>`;
    if (!ui.vast.choice) return `<div class="msg">Vast Move: tap a glowing cell to choose where the stack ends.<small>Pieces drop along the line, at least one per cell.</small></div><div class="row"><button class="btn" data-cancel>Cancel</button></div>`;
    const d = ui.vast.drops;
    const steps = d.map((n, i) => {
      const last = i === d.length - 1;
      return `<div class="step ${last ? "final" : ""}">${last ? "" : `<button data-plan="${i}" data-delta="-1" ${planAllowed(i, -1) ? "" : "disabled"} aria-label="One fewer">−</button>`}<b>${n}</b>${last ? "<small>last</small>" : `<button data-plan="${i}" data-delta="1" ${planAllowed(i, 1) ? "" : "disabled"} aria-label="One more">+</button>`}</div>`;
    }).join("");
    return `<div class="msg">Drop plan<small>The last cell takes whatever is left.</small></div><div class="plan">${steps}</div><div class="row"><button class="btn gold grow" data-commit-vast>Vast Move</button><button class="btn" data-cancel>Cancel</button></div>`;
  }
  if (ui.sel === null) return `<div class="msg">Your move <span class="you p${me}">${SYM[me]} ${NAMES[me]}</span><small>Tap an empty cell to Spawn, or one of your stacks to Grow or Vast Move.</small></div>`;
  const h = game.h[ui.sel], o = game.o[ui.sel];
  if (!h) {
    if (game.supply < 1) return `<div class="msg">The supply is empty, so you can't Spawn.<small>Move one of your stacks instead.</small></div><div class="row"><button class="btn" data-cancel>OK</button></div>`;
    return `<div class="msg">Spawn a piece on ${geo().names[ui.sel]}?</div><div class="row"><button class="btn gold grow" data-spawn>Spawn</button><button class="btn" data-cancel>Cancel</button></div>`;
  }
  if (o !== me) return `<div class="msg">${cellInfo(ui.sel)}</div><div class="row"><button class="btn" data-cancel>OK</button></div>`;
  const canGrow = game.supply > 0 && h < 5, canVast = h >= 2;
  const hints = [!canVast && "A single piece can't Vast Move.", game.supply < 1 && "The supply is empty, so you can't Grow.", canGrow && h === 4 && "Growing to 5 sets off a ripple."].filter(Boolean).join(" ");
  return `<div class="msg">Your stack of ${h} on ${geo().names[ui.sel]}.${hints ? `<small>${hints}</small>` : ""}</div>
    <div class="row"><button class="btn gold" data-grow ${canGrow ? "" : "disabled"}>Grow</button><button class="btn purple" data-vast ${canVast ? "" : "disabled"}>Vast Move</button><button class="btn" data-cancel>Cancel</button></div>`;
}

function cellInfo(i) {
  const g = ui.game;
  return g.h[i] ? `${geo().names[i]}: ${NAMES[g.o[i]]} stack of ${g.h[i]}.` : `${geo().names[i]}: empty.`;
}
function winnerText() {
  const g = ui.game;
  if (g.winner === "draw") return "It's a draw.";
  return `${esc(seatName(g.winner))} (${NAMES[g.winner]}) wins!`;
}

// --- Vast Move planning -------------------------------------------------------------
function buildGroups() {
  const v = ui.vast, g = geo();
  v.groups = new Map();
  for (const m of v.moves) {
    const key = `${m.dir}:${m.drops.length}`;
    if (!v.groups.has(key)) v.groups.set(key, { dir: m.dir, len: m.drops.length, plans: [] });
    v.groups.get(key).plans.push(m.drops);
  }
  v.dests = new Map();
  for (const grp of v.groups.values()) {
    const path = pathOf(g, v.from, grp.dir, grp.len);
    v.dests.set(path[path.length - 1], grp);
  }
}
const samePlan = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function shifted(i, delta) {
  const d = ui.vast.drops.slice();
  d[i] += delta;
  d[d.length - 1] -= delta;
  return d;
}
function planAllowed(i, delta) {
  const d = shifted(i, delta);
  return ui.vast.choice.plans.some(p => samePlan(p, d));
}

// --- Input ------------------------------------------------------------------------------
document.addEventListener("pointerdown", unlockAudio, { once: true });
app.addEventListener("click", e => {
  const t = e.target;
  const segBtn = t.closest("[data-seg]");
  if (segBtn) { ui.pick[segBtn.dataset.seg] = segBtn.dataset.v; sfx.select(); renderLobby(); return; }
  if (t.closest("[data-sound]")) { setSound(!soundOn()); if (soundOn()) sfx.select(); ui.room ? render() : renderLobby(); return; }
  if (t.closest("[data-start-solo]")) return createRoom("solo");
  if (t.closest("[data-create]")) return createRoom("online");
  if (t.closest("[data-join]")) {
    const code = (app.querySelector("[data-code]")?.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{5,8}$/.test(code)) { ui.error = "Type the room code."; renderLobby(); return; }
    return enterRoom(code);
  }
  if (t.closest("[data-rules]")) return showModal("rules");
  if (t.closest("[data-leave]")) return leave();
  if (t.closest("[data-copy]")) { navigator.clipboard?.writeText(ui.room.code).then(() => toast("Code copied.", true)).catch(() => {}); return; }
  if (t.closest("[data-concede]")) { if (confirm("Concede this game?")) send({ type: "concede" }); return; }
  if (t.closest("[data-rematch]")) { send({ type: "rematch" }); return; }
  if (t.closest("[data-result]")) return showModal("result");
  if (t.closest("[data-cancel]")) { ui.sel = null; ui.vast = null; sfx.cancel(); render(); return; }
  if (t.closest("[data-spawn]")) return act({ type: "spawn", cell: ui.sel });
  if (t.closest("[data-grow]")) return act({ type: "grow", cell: ui.sel });
  if (t.closest("[data-vast]")) {
    ui.vast = { from: ui.sel, moves: null, choice: null, drops: [] };
    send({ type: "options", from: ui.sel });
    sfx.select();
    render();
    return;
  }
  const planBtn = t.closest("[data-plan]");
  if (planBtn) {
    const i = Number(planBtn.dataset.plan), delta = Number(planBtn.dataset.delta);
    if (planAllowed(i, delta)) { ui.vast.drops = shifted(i, delta); sfx.select(); render(); }
    return;
  }
  if (t.closest("[data-commit-vast]")) {
    const v = ui.vast;
    return act({ type: "vast", from: v.from, dir: v.choice.dir, drops: v.drops });
  }
  const cell = t.closest("[data-i]");
  if (cell && ui.game && !ui.animating) onCell(Number(cell.dataset.i));
});
app.addEventListener("toggle", e => { if (e.target.matches?.(".ticker") && !isDesktop()) ui.tickerOpen = e.target.open; }, true);

function onCell(i) {
  const v = ui.vast;
  if (v?.dests?.has(i)) {
    const grp = v.dests.get(i);
    v.choice = grp;
    v.drops = grp.plans[0].slice();
    sfx.select();
    render();
    return;
  }
  ui.vast = null;
  ui.sel = ui.sel === i ? null : i;
  if (ui.sel !== null) sfx.select();
  render();
}

function act(action) {
  if (!myTurn()) return;
  ui.pending = true;
  send({ type: "action", action });
  render();
}

// --- Clock, toasts, banners, modals ---------------------------------------------------------
function tickClock() {
  const el = app.querySelector("[data-clock]");
  if (!el || !ui.room?.deadline) return;
  const left = Math.max(0, Math.ceil((ui.room.deadline - (Date.now() + ui.skew)) / 1000));
  el.textContent = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`;
  el.classList.toggle("low", left <= 10);
  if (left <= 5 && left > 0 && left !== ui.lastTick && myTurn()) { ui.lastTick = left; sfx.tick(); }
}
setInterval(tickClock, 250);
setInterval(() => send({ type: "ping" }), 25000);

function toast(text, good = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = `toast${good ? " good" : ""}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function banner(text) {
  if (REDUCED) return;
  document.querySelectorAll(".banner").forEach(b => b.remove());
  const el = document.createElement("div");
  el.className = "banner";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

const RULES_HTML = `<div class="rules">
  <h2>How to play</h2>
  <p>Two players, <b class="gold-t">Gold ★</b> and <b class="purple-t">Purple ◆</b>, fight over a hexagon of cells. Gold moves first. A cell belongs to whoever's colour is on top of its stack. Stacks hold at most 5 pieces. The shared supply has one piece fewer than the board has cells (60 on Standard, 90 on Large).</p>
  <h3>On your turn, do one thing</h3>
  <ul>
    <li><b>Spawn:</b> put a piece from the supply on an empty cell.</li>
    <li><b>Grow:</b> put a piece from the supply on top of a stack you own.</li>
    <li><b>Vast Move:</b> pick up a whole stack you own (2 or more pieces) and move it in a straight line, dropping at least one piece on each cell you pass. The last cell takes the rest. Dropping on any stack, even the opponent's, makes it yours. No cell may go above 5. Vast Moves don't use the supply.</li>
  </ul>
  <h3>Ripple</h3>
  <p>Make a stack of exactly 5 and it ripples straight away: those 5 pieces go back to the supply, and every stack touching that cell flips to your colour.</p>
  <h3>Winning</h3>
  <ul>
    <li>If a player who has already moved owns no cells, they lose.</li>
    <li>If it's your turn and you have no legal move (for example, the supply is empty and none of your stacks can move), you lose.</li>
    <li>At the move limit (400 on Standard, 600 on Large) the board is scored: most cells wins, then the tallest single stack, otherwise it's a draw.</li>
  </ul>
  <h3>Timer</h3>
  <p>With a move timer on, running out of time plays a random legal move for you.</p>
  <h3>Cell names</h3>
  <p>Rows are lettered A, B, C… from the top and cells numbered 1, 2, 3… from the left, so the move list reads like “Vast E5 → E7”.</p>
</div>`;

function showModal(kind) {
  document.querySelectorAll(".modal").forEach(m => m.remove());
  const el = document.createElement("div");
  el.className = "modal";
  let html = "";
  if (kind === "rules") html = `${RULES_HTML}<button class="btn gold" data-close>Got it</button>`;
  if (kind === "result" && ui.game) {
    const g = ui.game;
    const loser = g.winner === "draw" ? "" : NAMES[1 - g.winner];
    const why = (REASONS[g.reason] || (() => ""))(loser);
    const mine = ui.room?.you >= 0 && g.winner === ui.room.you;
    html = `<div class="result ${g.winner === "draw" ? "" : `w${g.winner}`}"><div class="crest">${g.winner === "draw" ? "⬡" : SYM[g.winner]}</div><h2>${mine ? "Victory" : winnerText()}</h2><p class="why">${esc(why)}</p>
      <div class="score">${[0, 1].map(p => `<div class="p${p}"><b>${SYM[p]} ${NAMES[p]}</b><span>${countOf(g, p)}</span><small>cells · tallest ${tallestOf(g, p)}</small></div>`).join("")}</div>
      <p class="why">${g.ply} moves played.</p></div><button class="btn gold" data-close>Close</button>`;
  }
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  document.body.appendChild(el);
}

// --- Start ----------------------------------------------------------------------------
const fromHash = location.hash.slice(1).toUpperCase();
if (/^[A-Z0-9]{5,8}$/.test(fromHash) && token) enterRoom(fromHash);
else renderLobby();
