// HEXAVAST client. All rules run on the server; this file draws the board, sends
// actions, and asks the server for a stack's legal Vast Moves.
import { CELLS, pathOf } from "./board.js";

const app = document.getElementById("app");
const NAMES = ["Gold", "Purple"];
const SYM = ["★", "◆"];
const TIMER_LABEL = { 0: "Off", 30: "30s", 60: "1 min", 120: "2 min" };
const REASONS = {
  elimination: loser => `${loser} has no cells left.`,
  stuck: loser => `${loser} had no legal move.`,
  limit: () => "Move limit reached, so the board was scored.",
  concede: loser => `${loser} conceded.`
};

const token = (() => { try { return localStorage.getItem("gooberCardsSession") || ""; } catch { return ""; } })();
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ui = {
  pick: { soloColor: "gold", soloTimer: 0, roomColor: "gold", roomTimer: 60 },
  error: "",
  code: null, ws: null, opened: false, failures: 0, leaving: false,
  room: null, game: null, events: [], queue: [], busy: false, skew: 0,
  sel: null, vast: null, pending: false, resultShown: null
};

// --- Lobby -------------------------------------------------------------------------
function seg(name, options, value) {
  return `<div class="seg" role="group">${options.map(([v, label]) => `<button type="button" data-seg="${name}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join("")}</div>`;
}
const colorOptions = [["gold", "Gold ★ (first)"], ["purple", "Purple ◆"], ["random", "Random"]];
const timerOptions = Object.entries(TIMER_LABEL).map(([v, l]) => [v, l]);

function renderLobby() {
  const p = ui.pick;
  app.innerHTML = `<div class="lobby">
    <div class="brand"><img src="/lab/logo.png" alt=""><div><h1>HEXAVAST</h1><p>Admin test build</p></div></div>
    ${token ? "" : `<p class="error">You're not logged in here. Log in on the main site, then reload this page.</p>`}
    <section class="card">
      <h2>Play the NPC</h2>
      <label>Your colour ${seg("soloColor", colorOptions, p.soloColor)}</label>
      <label>Move timer ${seg("soloTimer", timerOptions, p.soloTimer)}</label>
      <button class="btn gold" data-start-solo>Start game</button>
    </section>
    <section class="card">
      <h2>Play another admin</h2>
      <label>Your colour ${seg("roomColor", colorOptions, p.roomColor)}</label>
      <label>Move timer ${seg("roomTimer", timerOptions, p.roomTimer)}</label>
      <button class="btn purple" data-create>Create room</button>
      <div class="divider"></div>
      <div class="row"><input class="code grow" data-code maxlength="8" placeholder="Room code" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" data-join>Join</button></div>
    </section>
    <p class="error" data-error>${esc(ui.error)}</p>
    <button class="btn ghost" data-rules>How to play</button>
  </div>`;
}

async function createRoom(mode) {
  const p = ui.pick;
  const body = mode === "solo" ? { mode, color: p.soloColor, timer: Number(p.soloTimer) } : { mode, color: p.roomColor, timer: Number(p.roomTimer) };
  ui.error = "";
  try {
    const res = await fetch("/api/lab/rooms", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't make a room.");
    enterRoom(data.code);
  } catch (error) {
    ui.error = error.message;
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
  Object.assign(ui, { ws: null, code: null, room: null, game: null, events: [], queue: [], sel: null, vast: null, pending: false, resultShown: null, error });
  history.replaceState(null, "", location.pathname);
  renderLobby();
}

function onMessage(msg) {
  if (msg.type === "state") { ui.queue.push(msg); drain(); }
  else if (msg.type === "options") {
    if (ui.vast && ui.vast.from === msg.from) { ui.vast.moves = msg.moves; buildGroups(); render(); }
  } else if (msg.type === "error") {
    ui.pending = false;
    toast(msg.message);
    render();
  }
}

// States are shown in order. When a move is followed by another (an NPC reply or a
// timed-out turn), pause briefly so the first move is visible before the next.
function drain() {
  while (!ui.busy && ui.queue.length) {
    const msg = ui.queue.shift();
    const turnChanged = !ui.game || !msg.game || msg.game.ply !== ui.game.ply || msg.game.over !== ui.game.over;
    ui.room = msg.room;
    ui.game = msg.game;
    ui.events = msg.events || [];
    ui.skew = msg.room.now - Date.now();
    if (turnChanged) { ui.sel = null; ui.vast = null; ui.pending = false; }
    render();
    if (ui.events.length && ui.queue.length) {
      ui.busy = true;
      setTimeout(() => { ui.busy = false; drain(); }, 650);
    }
  }
}

// --- Game view -------------------------------------------------------------------------
const myTurn = () => ui.room?.phase === "playing" && ui.room.you >= 0 && ui.game && ui.game.toMove === ui.room.you && !ui.pending;
const owned = p => ui.game ? ui.game.o.reduce((n, o) => n + (o === p ? 1 : 0), 0) : 0;
const tallest = p => ui.game ? ui.game.h.reduce((m, h, i) => (ui.game.o[i] === p ? Math.max(m, h) : m), 0) : 0;
const seatName = p => ui.room?.seats[p]?.name || NAMES[p];

function render() {
  if (!ui.room) { renderLobby(); return; }
  const { room, game } = ui;
  const players = [0, 1].map(p => {
    const seat = room.seats[p];
    const turn = room.phase === "playing" && game && game.toMove === p;
    return `<div class="player p${p} ${turn ? "turn" : ""}">
      <span class="disc" aria-hidden="true">${SYM[p]}</span>
      <span class="name">${esc(seat ? seat.name : "Waiting…")}${room.you === p ? " (you)" : ""}</span>
      <span class="stats">${NAMES[p]} · ${owned(p)} cells · tallest ${tallest(p)}${seat && !seat.connected ? ` <span class="off">offline</span>` : ""}</span>
      ${turn && room.deadline ? `<span class="clock" data-clock></span>` : ""}
    </div>`;
  }).join("");
  const body = room.phase === "waiting"
    ? `<section class="card waiting"><h2>Waiting for another admin</h2><div class="bigcode">${esc(room.code)}</div><p class="note">Share this code. They open this page and join with it.</p><button class="btn" data-copy>Copy code</button></section>`
    : `<div class="board-wrap">${boardSVG()}</div>`;
  app.innerHTML = `<div class="game">
    <div class="topbar"><span class="logo" aria-hidden="true"></span><span class="title">HEXAVAST</span><span class="chip">${room.mode === "solo" ? "vs NPC" : `Room ${esc(room.code)}`}</span>${room.timer ? `<span class="chip">⏱ ${TIMER_LABEL[room.timer]}</span>` : ""}<span class="spacer"></span>
      <button class="btn small ghost" data-rules>Rules</button>
      ${room.phase === "playing" && room.you >= 0 ? `<button class="btn small danger" data-concede>Concede</button>` : ""}
      <button class="btn small ghost" data-leave>Leave</button></div>
    <div class="side"><div class="players">${players}</div>
      <div class="meta"><span>Supply: ${game ? game.supply : 60}</span><span>Move ${game ? game.ply + 1 : 1}</span></div></div>
    ${body}
  </div>
  <div class="actionbar"><div class="inner">${actionHTML()}</div></div>`;
  tickClock();
  if (room.phase === "over" && game && ui.resultShown !== resultKey()) { ui.resultShown = resultKey(); showModal("result"); }
}
const resultKey = () => `${ui.game.seed}:${ui.game.ply}`;

// Pointy-top hexes, axial coordinates.
const SIZE = 40, SQ3 = Math.sqrt(3);
const centre = i => ({ x: SIZE * SQ3 * (CELLS[i].q + CELLS[i].r / 2), y: SIZE * 1.5 * CELLS[i].r });
const hexPoints = ({ x, y }, radius = SIZE) => Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * (60 * k - 30);
  return `${(x + radius * Math.cos(a)).toFixed(1)},${(y + radius * Math.sin(a)).toFixed(1)}`;
}).join(" ");

function boardSVG() {
  const g = ui.game;
  if (!g) return "";
  const w = SIZE * SQ3 * 9 + 24, h = SIZE * 14 + 24;
  const last = new Set(), flash = new Set(), ripples = [];
  for (const e of ui.events) {
    if (e.t === "spawn" || e.t === "grow") last.add(e.cell);
    if (e.t === "vast") { last.add(e.from); e.path.forEach(c => last.add(c)); }
    if (e.t === "ripple") { ripples.push(e.cell); e.flipped.forEach(c => flash.add(c)); flash.add(e.cell); }
  }
  const plan = ui.vast?.choice ? pathOf(ui.vast.from, ui.vast.choice.dir, ui.vast.drops.length) : [];
  const dests = ui.vast?.dests || new Map();
  const interactive = myTurn();
  let cells = "";
  CELLS.forEach((c, i) => {
    const p = centre(i);
    const cls = ["cell", c.ring % 2 ? "alt" : "", interactive ? "tap" : "", ui.sel === i ? "sel" : "", dests.has(i) && !ui.vast?.choice ? "dest" : "", plan.includes(i) ? "path" : "", last.has(i) ? "last" : "", flash.has(i) ? "flash" : ""].filter(Boolean).join(" ");
    const height = g.h[i], owner = g.o[i];
    const label = height ? `${NAMES[owner]} stack of ${height}` : "Empty cell";
    let stack = "";
    if (height) {
      // Hexagonal pieces, same orientation as the cell, stacked with a small lift.
      const r = SIZE * 0.66;
      for (let k = 0; k < height; k++) {
        const cy = p.y + (height - 1) * 2.2 - k * 4.4;
        stack += `<polygon class="piece p${owner}" points="${hexPoints({ x: p.x, y: cy }, r)}"/>`;
      }
      const top = p.y - (height - 1) * 2.2;
      stack += `<text class="sym p${owner}" x="${p.x.toFixed(1)}" y="${(top - 8).toFixed(1)}" text-anchor="middle" font-size="12">${SYM[owner]}</text>`;
      stack += `<text class="num p${owner}" x="${p.x.toFixed(1)}" y="${(top + 12).toFixed(1)}" text-anchor="middle" font-size="19">${height}</text>`;
      stack = `<g class="stack">${stack}</g>`;
    }
    let extra = "";
    if (dests.has(i) && !ui.vast?.choice) extra = `<circle class="hint" cx="${p.x.toFixed(1)}" cy="${(p.y + SIZE * 0.62).toFixed(1)}" r="5"/>`;
    const at = plan.indexOf(i);
    if (at >= 0) extra = `<text class="drop" x="${(p.x + SIZE * 0.5).toFixed(1)}" y="${(p.y - SIZE * 0.45).toFixed(1)}" text-anchor="middle" font-size="16">+${ui.vast.drops[at]}</text>`;
    cells += `<g class="${cls}" data-i="${i}" role="button" aria-label="${label}"><title>${label}</title><polygon points="${hexPoints(p)}"/>${stack}${extra}</g>`;
  });
  const rings = ripples.map(i => { const p = centre(i); return `<circle class="ripple-ring" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${SIZE}"/>`; }).join("");
  return `<svg class="board" viewBox="${-w / 2} ${-h / 2} ${w} ${h}" aria-label="Board">${cells}${rings}</svg>`;
}

function actionHTML() {
  const { room, game } = ui;
  if (room.phase === "waiting") return `<div class="msg">Waiting for an opponent to join with code <b>${esc(room.code)}</b>.</div>`;
  if (!game) return "";
  if (room.phase === "over") {
    const waitingOther = room.mode === "online" && room.you >= 0 && room.rematch[room.you];
    return `<div class="msg">${winnerText()}</div><div class="row">${room.you >= 0 ? `<button class="btn gold" data-rematch ${waitingOther ? "disabled" : ""}>${waitingOther ? "Waiting for rematch…" : "Rematch"}</button>` : ""}<button class="btn" data-result>Result</button><button class="btn ghost" data-leave>Lobby</button></div>`;
  }
  if (room.you < 0) return `<div class="msg">Watching. ${NAMES[game.toMove]} to move.</div>`;
  if (ui.pending) return `<div class="msg">Sending…</div>`;
  if (game.toMove !== room.you) {
    const npc = room.seats[game.toMove]?.npc;
    return `<div class="msg">${esc(seatName(game.toMove))} (${NAMES[game.toMove]}) ${npc ? "is thinking…" : "to move."}${ui.sel !== null ? `<small>${cellInfo(ui.sel)}</small>` : ""}</div>`;
  }
  const me = room.you;
  if (ui.vast) {
    if (!ui.vast.moves) return `<div class="msg">Finding Vast Moves…</div>`;
    if (!ui.vast.moves.length) return `<div class="msg">This stack has no legal Vast Move.</div><div class="row"><button class="btn" data-cancel>Back</button></div>`;
    if (!ui.vast.choice) return `<div class="msg">Vast Move: tap a highlighted cell to choose where the stack ends.<small>Pieces drop along the line, at least one per cell.</small></div><div class="row"><button class="btn" data-cancel>Cancel</button></div>`;
    const d = ui.vast.drops;
    const steps = d.map((n, i) => {
      const last = i === d.length - 1;
      return `<div class="step ${last ? "final" : ""}">${last ? "" : `<button data-plan="${i}" data-delta="-1" ${planAllowed(i, -1) ? "" : "disabled"} aria-label="One fewer">−</button>`}<b>${n}</b>${last ? "<small>last</small>" : `<button data-plan="${i}" data-delta="1" ${planAllowed(i, 1) ? "" : "disabled"} aria-label="One more">+</button>`}</div>`;
    }).join("");
    return `<div class="msg">Drop plan along the line<small>The last cell takes whatever is left.</small></div><div class="plan">${steps}</div><div class="row"><button class="btn gold grow" data-commit-vast>Vast Move</button><button class="btn" data-cancel>Cancel</button></div>`;
  }
  if (ui.sel === null) return `<div class="msg">Your move (${NAMES[me]} ${SYM[me]})<small>Tap an empty cell to Spawn, or one of your stacks to Grow or Vast Move.</small></div>`;
  const h = game.h[ui.sel], o = game.o[ui.sel];
  if (!h) {
    if (game.supply < 1) return `<div class="msg">The supply is empty, so you can't Spawn.<small>Move one of your stacks instead.</small></div><div class="row"><button class="btn" data-cancel>OK</button></div>`;
    return `<div class="msg">Spawn a piece here?</div><div class="row"><button class="btn gold grow" data-spawn>Spawn</button><button class="btn" data-cancel>Cancel</button></div>`;
  }
  if (o !== me) return `<div class="msg">${cellInfo(ui.sel)}</div><div class="row"><button class="btn" data-cancel>OK</button></div>`;
  const canGrow = game.supply > 0 && h < 5, canVast = h >= 2;
  const hints = [!canVast && "A single piece can't Vast Move.", game.supply < 1 && "The supply is empty, so you can't Grow.", canGrow && h === 4 && "Growing to 5 sets off a ripple."].filter(Boolean).join(" ");
  return `<div class="msg">Your stack of ${h}.${hints ? `<small>${hints}</small>` : ""}</div>
    <div class="row"><button class="btn gold" data-grow ${canGrow ? "" : "disabled"}>Grow</button><button class="btn purple" data-vast ${canVast ? "" : "disabled"}>Vast Move</button><button class="btn" data-cancel>Cancel</button></div>`;
}

function cellInfo(i) {
  const g = ui.game;
  return g.h[i] ? `${NAMES[g.o[i]]} stack of ${g.h[i]}.` : "Empty cell.";
}

function winnerText() {
  const g = ui.game;
  if (g.winner === "draw") return "It's a draw.";
  const name = seatName(g.winner);
  return `${esc(name)} (${NAMES[g.winner]}) wins!`;
}

// --- Vast Move planning -------------------------------------------------------------
function buildGroups() {
  const v = ui.vast;
  v.groups = new Map();
  for (const m of v.moves) {
    const key = `${m.dir}:${m.drops.length}`;
    if (!v.groups.has(key)) v.groups.set(key, { dir: m.dir, len: m.drops.length, plans: [] });
    v.groups.get(key).plans.push(m.drops);
  }
  v.dests = new Map();
  for (const grp of v.groups.values()) {
    const path = pathOf(v.from, grp.dir, grp.len);
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
  const grp = ui.vast.choice;
  const d = shifted(i, delta);
  return grp.plans.some(p => samePlan(p, d));
}

// --- Input ------------------------------------------------------------------------------
app.addEventListener("click", e => {
  const t = e.target;
  const segBtn = t.closest("[data-seg]");
  if (segBtn) { ui.pick[segBtn.dataset.seg] = segBtn.dataset.v; renderLobby(); return; }
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
  if (t.closest("[data-cancel]")) { ui.sel = null; ui.vast = null; render(); return; }
  if (t.closest("[data-spawn]")) return act({ type: "spawn", cell: ui.sel });
  if (t.closest("[data-grow]")) return act({ type: "grow", cell: ui.sel });
  if (t.closest("[data-vast]")) {
    ui.vast = { from: ui.sel, moves: null, choice: null, drops: [] };
    send({ type: "options", from: ui.sel });
    render();
    return;
  }
  const planBtn = t.closest("[data-plan]");
  if (planBtn) {
    const i = Number(planBtn.dataset.plan), delta = Number(planBtn.dataset.delta);
    if (planAllowed(i, delta)) { ui.vast.drops = shifted(i, delta); render(); }
    return;
  }
  if (t.closest("[data-commit-vast]")) {
    const v = ui.vast;
    return act({ type: "vast", from: v.from, dir: v.choice.dir, drops: v.drops });
  }
  const cell = t.closest("[data-i]");
  if (cell && ui.game) onCell(Number(cell.dataset.i));
});

function onCell(i) {
  const v = ui.vast;
  if (v?.dests?.has(i)) {
    const grp = v.dests.get(i);
    v.choice = grp;
    v.drops = grp.plans[0].slice();
    render();
    return;
  }
  ui.vast = null;
  ui.sel = ui.sel === i ? null : i;
  render();
}

function act(action) {
  if (!myTurn()) return;
  ui.pending = true;
  send({ type: "action", action });
  render();
}

// --- Clock, toasts, modals ---------------------------------------------------------------
function tickClock() {
  const el = app.querySelector("[data-clock]");
  if (!el || !ui.room?.deadline) return;
  const left = Math.max(0, Math.ceil((ui.room.deadline - (Date.now() + ui.skew)) / 1000));
  el.textContent = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`;
  el.classList.toggle("low", left <= 10);
}
setInterval(tickClock, 250);
setInterval(() => send({ type: "ping" }), 25000);

function toast(text, good = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  if (good) el.style.cssText = "background:#24331f;border-color:#3f6a34;color:#d6ffcc";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const RULES_HTML = `<div class="rules">
  <h2>How to play HEXAVAST</h2>
  <p>Two players, Gold ★ and Purple ◆, fight over a hexagon of 61 cells. Gold moves first. A cell belongs to whoever's colour is on top of its stack. Stacks hold at most 5 pieces. There are 60 pieces in a shared supply.</p>
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
    <li>After 400 moves the board is scored: most cells wins, then the tallest single stack, otherwise it's a draw.</li>
  </ul>
  <h3>Timer</h3>
  <p>With a move timer on, running out of time plays a random legal move for you.</p>
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
    html = `<div class="result"><h2>${winnerText()}</h2><p class="why">${esc(why)}</p>
      <div class="score">${[0, 1].map(p => `<div><b>${SYM[p]} ${NAMES[p]}</b><br>${owned(p)} cells · tallest ${tallest(p)}</div>`).join("")}</div>
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
