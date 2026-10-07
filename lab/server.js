// Admin-only lab: page, assets, room API and the LabRoom Durable Object.
// Everything here answers 404 to anyone who isn't an admin, exactly like an unknown URL.
import { createGame, applyAction, vastMovesFrom, randomAction, BOARD_SIZES, GOLD, PURPLE } from "./engine.js";
import { chooseAction, LEVELS, DEFAULT_LEVEL } from "./ai.js";
import PAGE_HTML from "./web/index.html";
import APP_JS from "./web/app.js";
import BOARD_JS from "./web/board.js";
import SOUND_JS from "./web/sound.js";
import STYLE_CSS from "./web/style.css";
import LOGO_PNG from "./web/logo.png";

export const ADMIN_COOKIE = "gb_admin";
const TIMERS = new Set([0, 30, 60, 120]);
const ROOM_RE = /^\/api\/lab\/rooms\/([A-Z0-9]{5,8})\/socket$/;
const PRIVATE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
};
const ASSETS = {
  "/lab/": [PAGE_HTML, "text/html; charset=utf-8"],
  "/lab/app.js": [APP_JS, "text/javascript; charset=utf-8"],
  "/lab/board.js": [BOARD_JS, "text/javascript; charset=utf-8"],
  "/lab/sound.js": [SOUND_JS, "text/javascript; charset=utf-8"],
  "/lab/style.css": [STYLE_CSS, "text/css; charset=utf-8"],
  "/lab/logo.png": [LOGO_PNG, "image/png"]
};

export const isLabPath = path => path === "/lab" || path.startsWith("/lab/") || path.startsWith("/api/lab/");

export function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

// Set on login and session checks for admin accounts only, so a page navigation
// (which can't carry the Bearer token) can still be checked.
export function adminCookie(token, maxAgeSeconds) {
  return `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearAdminCookie = () => `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// helpers: { userFromToken, isAdminUser, jsonResponse }
export async function routeLab(request, env, helpers) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isApi = path.startsWith("/api/lab/");
  const notFound = () => (isApi ? helpers.jsonResponse({ error: "Not found" }, 404) : new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", ...PRIVATE_HEADERS } }));

  const auth = request.headers.get("authorization") || "";
  const token = (auth.startsWith("Bearer ") ? auth.slice(7) : "") || url.searchParams.get("auth") || readCookie(request, ADMIN_COOKIE);
  const user = await helpers.userFromToken(env, token);
  if (!user || !helpers.isAdminUser(user)) return notFound();

  if (!isApi) {
    if (path === "/lab") return new Response(null, { status: 302, headers: { location: "/lab/", ...PRIVATE_HEADERS } });
    const asset = ASSETS[path];
    if (!asset) return notFound();
    return new Response(asset[0], { headers: { "content-type": asset[1], ...PRIVATE_HEADERS } });
  }

  if (!env.LAB_ROOMS) return notFound();
  if (path === "/api/lab/rooms" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "solo" ? "solo" : "online";
    const timer = TIMERS.has(Number(body.timer)) ? Number(body.timer) : 0;
    const color = ["gold", "purple", "random"].includes(body.color) ? body.color : "gold";
    const size = BOARD_SIZES[body.size] ? body.size : "standard";
    const level = mode === "solo" && LEVELS[body.level] ? body.level : DEFAULT_LEVEL;
    for (let i = 0; i < 4; i++) {
      const code = roomCode();
      const res = await roomStub(env, code).fetch("https://lab.internal/init", {
        method: "POST",
        body: JSON.stringify({ code, mode, timer, color, size, level, user: { id: String(user.id), name: user.username } })
      });
      if (res.ok) return helpers.jsonResponse({ code, mode, timer, size }, 201, PRIVATE_HEADERS);
    }
    return helpers.jsonResponse({ error: "Couldn't make a room. Try again." }, 503, PRIVATE_HEADERS);
  }
  const match = path.match(ROOM_RE);
  if (match && request.headers.get("upgrade") === "websocket") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return notFound();
    const headers = new Headers({ upgrade: "websocket", "x-lab-user-id": String(user.id), "x-lab-user-name": user.username });
    for (const h of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) {
      if (request.headers.get(h)) headers.set(h, request.headers.get(h));
    }
    return roomStub(env, match[1]).fetch("https://lab.internal/socket", { headers });
  }
  return notFound();
}

function roomStub(env, code) { return env.LAB_ROOMS.get(env.LAB_ROOMS.idFromName(code)); }
function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}
// Compact record of a move for the move list: who, what, where, and any ripples.
function tickerEntry(seat, action, result) {
  const e = { n: result.state.ply, p: seat, k: action.type };
  for (const ev of result.events) {
    if (ev.t === "spawn") e.c = ev.cell;
    if (ev.t === "grow") { e.c = ev.cell; e.h = ev.height; }
    if (ev.t === "vast") { e.f = ev.from; e.d = ev.dir; e.dr = ev.drops; e.to = ev.path[ev.path.length - 1]; }
    if (ev.t === "ripple") (e.rp = e.rp || []).push([ev.cell, ev.flipped.length]);
    if (ev.t === "end") { e.w = ev.winner; e.r = ev.reason; }
  }
  if (action.timedOut) e.t = 1;
  return e;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// --- Room ------------------------------------------------------------------------
// Seat index = colour: seat 0 plays Gold (moves first), seat 1 plays Purple.
export class LabRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.room = undefined;
  }

  async load() {
    if (this.room === undefined) this.room = (await this.state.storage.get("room")) || null;
    return this.room;
  }
  async save() { await this.state.storage.put("room", this.room); }

  async fetch(request) {
    const url = new URL(request.url);
    await this.load();
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.room) return json({ error: "taken" }, 409);
      const body = await request.json();
      const creator = { userId: body.user.id, name: body.user.name };
      const seat = body.color === "purple" ? PURPLE : body.color === "random" ? (crypto.getRandomValues(new Uint8Array(1))[0] & 1) : GOLD;
      const seats = [null, null];
      seats[seat] = creator;
      if (body.mode === "solo") seats[1 - seat] = { npc: true, name: "NPC" };
      this.room = { code: body.code, mode: body.mode, timer: body.timer, size: BOARD_SIZES[body.size] ? body.size : "standard", level: LEVELS[body.level] ? body.level : DEFAULT_LEVEL, seats, game: null, phase: "waiting", deadline: 0, rematch: [false, false], log: [], ticker: [], created: Date.now() };
      if (body.mode === "solo") this.startGame();
      await this.save();
      return json({ ok: true });
    }
    if (url.pathname === "/socket" && request.headers.get("upgrade") === "websocket") {
      if (!this.room) return json({ error: "Room not found." }, 404);
      return this.connect(request.headers.get("x-lab-user-id"), request.headers.get("x-lab-user-name") || "Admin");
    }
    return json({ error: "Not found" }, 404);
  }

  async connect(userId, name) {
    const room = this.room;
    let seat = room.seats.findIndex(s => s && !s.npc && s.userId === userId);
    if (seat < 0 && room.phase === "waiting") {
      seat = room.seats.findIndex(s => !s);
      if (seat >= 0) { room.seats[seat] = { userId, name }; this.startGame(); await this.save(); }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.set(server, { seat });
    server.addEventListener("message", event => {
      this.onMessage(server, event.data).catch(error => {
        console.error(error);
        this.send(server, { type: "error", message: error.message || "Room error." });
      });
    });
    const close = () => { this.sessions.delete(server); this.broadcast(); };
    server.addEventListener("close", close);
    server.addEventListener("error", close);
    this.sendState(server, []);
    this.broadcast([], server);
    return new Response(null, { status: 101, webSocket: client });
  }

  startGame() {
    const room = this.room;
    room.game = createGame({ seed: crypto.getRandomValues(new Uint32Array(1))[0], radius: BOARD_SIZES[room.size] || BOARD_SIZES.standard });
    room.phase = "playing";
    room.rematch = [false, false];
    room.log = [];
    room.ticker = [];
    this.startTurn();
  }

  startTurn() {
    const room = this.room;
    if (room.game.over) {
      room.phase = "over";
      room.deadline = 0;
      this.state.storage.deleteAlarm();
      return;
    }
    const mover = room.seats[room.game.toMove];
    if (room.timer && mover && !mover.npc) {
      room.deadline = Date.now() + room.timer * 1000;
      this.state.storage.setAlarm(room.deadline);
    } else {
      room.deadline = 0;
    }
  }

  // Apply an action for `seat`, then let the NPC answer. Returns an error string or "".
  play(seat, action) {
    const room = this.room;
    const result = applyAction(room.game, seat, action);
    if (!result.ok) return result.error;
    room.game = result.state;
    room.log.push([seat, action]);
    room.ticker = room.ticker || [];
    room.ticker.push(tickerEntry(seat, action, result));
    this.startTurn();
    this.broadcast(result.events);
    this.npcTurn();
    return "";
  }

  npcTurn() {
    const room = this.room;
    const g = room.game;
    if (g.over || !room.seats[g.toMove]?.npc) return;
    const action = chooseAction(g, g.toMove, LEVELS[room.level] || LEVELS[DEFAULT_LEVEL]) || randomAction(g);
    if (action) this.play(g.toMove, action);
  }

  async alarm() {
    await this.load();
    const room = this.room;
    if (!room || room.phase !== "playing" || !room.deadline) return;
    if (Date.now() < room.deadline - 250) { this.state.storage.setAlarm(room.deadline); return; }
    const seat = room.game.toMove;
    const action = randomAction(room.game);
    if (action) this.play(seat, { ...action, timedOut: true });
    await this.save();
  }

  async onMessage(ws, raw) {
    const session = this.sessions.get(ws);
    if (!session || typeof raw !== "string" || raw.length > 4000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = this.room;
    const seat = session.seat;
    if (msg.type === "ping") return this.send(ws, { type: "pong" });
    if (seat < 0) return this.send(ws, { type: "error", message: "You're watching this game." });
    if (msg.type === "options") {
      if (!room.game) return;
      return this.send(ws, { type: "options", from: msg.from, moves: room.game.toMove === seat ? vastMovesFrom(room.game, msg.from, seat) : [] });
    }
    if (msg.type === "action" && room.phase === "playing") {
      const a = msg.action || {};
      const action = a.type === "vast" ? { type: "vast", from: a.from, dir: a.dir, drops: a.drops } : { type: a.type, cell: a.cell };
      const error = this.play(seat, action);
      if (error) return this.send(ws, { type: "error", message: error });
      return this.save();
    }
    if (msg.type === "concede" && room.phase === "playing") {
      this.play(seat, { type: "concede" });
      return this.save();
    }
    if (msg.type === "rematch" && room.phase === "over") {
      room.rematch[seat] = true;
      const other = room.seats[1 - seat];
      if (other?.npc || room.rematch[1 - seat]) {
        // Online rematches swap colours so the other player moves first.
        if (room.mode === "online") {
          room.seats.reverse();
          this.sessions.forEach(s => { if (s.seat >= 0) s.seat = 1 - s.seat; });
        }
        this.startGame();
        this.broadcast([]);
        this.npcTurn();
      } else {
        this.broadcast([]);
      }
      return this.save();
    }
  }

  view(seat) {
    const room = this.room;
    const watching = new Set([...this.sessions.values()].map(s => s.seat));
    return {
      code: room.code, mode: room.mode, timer: room.timer, size: room.size || "standard", level: room.level || DEFAULT_LEVEL, phase: room.phase, deadline: room.deadline, now: Date.now(),
      ticker: room.ticker || [],
      you: seat,
      rematch: room.rematch,
      seats: room.seats.map((s, i) => (s ? { name: s.name, npc: Boolean(s.npc), connected: Boolean(s.npc) || watching.has(i) } : null))
    };
  }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ } }
  sendState(ws, events) {
    const s = this.sessions.get(ws);
    if (s) this.send(ws, { type: "state", room: this.view(s.seat), game: this.room.game, events });
  }
  broadcast(events = [], except = null) {
    for (const ws of this.sessions.keys()) if (ws !== except) this.sendState(ws, events);
  }
}
