import { buildCatalog, validateDeck, cardFromGoober } from "../public/goober-cards/cards.js";
import { createGame, applyAction, viewFor, eventsFor } from "../public/goober-cards/engine.js";
import * as econ from "../public/goober-cards/economy.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return corsResponse(null, 204);
      if (url.pathname === "/api/goobers" && request.method === "GET") return await listGoobers(env);
      if (url.pathname === "/api/goobers" && request.method === "POST") return await uploadGoober(request, env);
      if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/profile" || url.pathname.startsWith("/api/econ/")) return await routeAccounts(request, env, url);
      if (url.pathname === "/api/card-battle/create" && request.method === "POST") return await createCardBattleRoom();
      if ((url.pathname === "/api/card-battle/matchmaking" || url.pathname === "/api/card-battle/live") && request.method === "GET") return await routeMatchmaking(request, env);
      if (url.pathname.startsWith("/api/card-battle/") && request.method === "GET") return await routeCardBattleRoom(request, env);
      if (url.pathname === "/api/goobers/pending" && request.method === "GET") return await listPendingGoobers(request, env);
      if (/^\/api\/goobers\/[^/]+\/approve$/.test(url.pathname) && request.method === "POST") return await approveGoober(request, env);
      if (url.pathname.startsWith("/api/goobers/") && request.method === "DELETE") return await deleteGoober(request, env);
      if (url.pathname.startsWith("/api/goober-image/") && request.method === "GET") return await getGooberImage(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: error.message || "Server error" }, 500);
    }
  }
};

const TURN_SECONDS = 90;
const MAX_TIMEOUTS = 3;
const EMOTES = new Set(["woof", "wow", "oops", "thanks", "gg", "hello"]);
const MAX_WATCHERS = 50;
const LIVE_TTL_MS = 30 * 60 * 1000;

// One online Goober Cards match. The room is authoritative: clients send actions,
// the shared engine validates and applies them, and each seat gets its own view.
export class CardBattleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.room = null;
  }

  emptyRoom(code) {
    return { code, phase: "lobby", seats: [null, null], game: null, deadline: 0, timeouts: [0, 0], rematch: [false, false], created: Date.now() };
  }

  async loadRoom(code) {
    if (this.room) return;
    this.room = (await this.state.storage.get("room2")) || this.emptyRoom(code);
  }

  async saveRoom() { await this.state.storage.put("room2", this.room); }

  async getCatalog() { return loadCatalog(this.env); }

  async fetch(request) {
    const url = new URL(request.url);
    const code = getRoomCodeFromPath(url.pathname);
    if (!code) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS);
    await this.loadRoom(code);
    // Internal call from the matchmaker (the public route never forwards POSTs to rooms):
    // matchmade rooms show up in the live list, and some are ranked.
    if (request.method === "POST" && url.pathname.endsWith("/setup")) {
      const body = await request.json().catch(() => ({}));
      if (this.room.phase === "lobby" && !this.room.game && !this.room.seats.some(Boolean)) {
        this.room.public = true;
        if (body.ranks && typeof body.ranks === "object") this.room.ranked = { ranks: body.ranks, users: Object.keys(body.ranks), gameId: null };
        await this.saveRoom();
      }
      return jsonResponse({ ok: true }, 200, NO_STORE_HEADERS);
    }
    if (request.headers.get("upgrade") !== "websocket") {
      return jsonResponse({ code, phase: this.room.phase, players: this.room.seats.map(s => (s ? { name: s.name, connected: s.connected } : null)) }, 200, NO_STORE_HEADERS);
    }

    const token = cleanText(url.searchParams.get("token"), 64);
    const name = cleanText(url.searchParams.get("name"), 24) || "Goober Fan";
    const hero = cleanText(url.searchParams.get("hero"), 80);
    // Logged-in players get rewards paid by the room, and their decks are checked against their collection.
    const account = await userFromToken(this.env, url.searchParams.get("auth"));
    // Watchers (?watch=1, or anyone once both seats are taken) get seat -1 and a view with both hands hidden.
    const watching = url.searchParams.get("watch") === "1";
    let seat = watching ? -1 : this.room.seats.findIndex(s => s && token && s.token === token);
    if (seat < 0 && token && !watching) seat = this.room.seats.findIndex(s => !s);
    if (seat < 0 && this.watcherCount() >= MAX_WATCHERS) return jsonResponse({ error: "Too many people are watching this match." }, 429, NO_STORE_HEADERS);
    if (seat >= 0) {
      const prev = this.room.seats[seat];
      const displayName = account ? account.username : name;
      this.room.seats[seat] = { ...(prev || { deck: null }), token, name: displayName, hero, connected: true, userId: account?.id || prev?.userId || null };
      if (this.room.game) this.room.game.players[seat].name = displayName;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.set(server, { seat });
    server.addEventListener("message", event => {
      this.handleMessage(server, event.data).catch(error => {
        console.error(error);
        this.send(server, { type: "error", message: error.message || "Room error." });
      });
    });
    const onClose = async () => {
      const session = this.sessions.get(server);
      this.sessions.delete(server);
      if (session && session.seat >= 0 && this.room.seats[session.seat]) {
        const stillHere = [...this.sessions.values()].some(s => s.seat === session.seat);
        if (!stillHere) this.room.seats[session.seat].connected = false;
        await this.saveRoom();
        this.broadcast();
      } else if (session) {
        this.broadcast();
      }
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    await this.saveRoom();
    this.send(server, { type: "catalog", cards: await this.getCatalog() });
    this.broadcast();
    this.retryRewards();
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(socket, data) {
    let message;
    try { message = JSON.parse(data); } catch { throw new Error("Invalid room message."); }
    const session = this.sessions.get(socket);
    if (!session) throw new Error("Session not found.");
    const seat = session.seat;
    const isPlayer = seat === 0 || seat === 1;

    if (message.type === "ping") { this.retryRewards(); return this.send(socket, { type: "pong" }); }

    if (message.type === "emote") {
      if (!isPlayer || !EMOTES.has(message.key)) return;
      const now = Date.now();
      if (session.lastEmote && now - session.lastEmote < 1500) return;
      session.lastEmote = now;
      for (const s of this.sessions.keys()) this.send(s, { type: "emote", seat, key: message.key });
      return;
    }

    if (!isPlayer) throw new Error("You're watching this match.");

    if (message.type === "deck") {
      if (this.room.phase !== "lobby") throw new Error("The match already started.");
      const catalog = await this.getCatalog();
      const entries = Array.isArray(message.deck) ? message.deck.slice(0, 40).map(e => ({ id: cleanText(e?.id, 80), shiny: Boolean(e?.shiny) })) : [];
      const check = validateDeck(catalog, entries.map(e => e.id));
      if (!check.ok) throw new Error(check.error);
      await this.checkOwnership(seat, entries);
      this.room.seats[seat].deck = entries;
      this.maybeStart();
    } else if (message.type === "action") {
      if (this.room.phase !== "playing" || !this.room.game) throw new Error("The match hasn't started.");
      const catalog = await this.getCatalog();
      const turnBefore = this.room.game.turn;
      const result = applyAction(this.room.game, catalog, seat, sanitizeAction(message.action));
      if (!result.ok) throw new Error(result.error);
      this.room.timeouts[seat] = 0;
      this.afterAction(result.events, turnBefore);
      await this.saveRoom();
      return;
    } else if (message.type === "rematch") {
      if (this.room.phase !== "over") return;
      this.room.rematch[seat] = true;
      if (Array.isArray(message.deck)) {
        const catalog = await this.getCatalog();
        const entries = message.deck.slice(0, 40).map(e => ({ id: cleanText(e?.id, 80), shiny: Boolean(e?.shiny) }));
        if (validateDeck(catalog, entries.map(e => e.id)).ok && await this.checkOwnership(seat, entries).then(() => true, () => false)) this.room.seats[seat].deck = entries;
      }
      if (this.room.rematch[0] && this.room.rematch[1]) { this.room.phase = "lobby"; this.room.game = null; this.maybeStart(); }
    }
    await this.saveRoom();
    this.broadcast();
  }

  watcherCount() { return [...this.sessions.values()].filter(s => s.seat < 0).length; }

  // Tell the matchmaker's live list about matchmade games (fire and forget).
  reportLive(status) {
    if (!this.room.public || !this.env.MATCHMAKER) return;
    const players = this.room.seats.map(s => {
      const rp = s?.userId && this.room.ranked ? this.room.ranked.ranks[s.userId] : undefined;
      return { name: s?.name || "?", ...(rp !== undefined && rp !== null ? { tier: econ.tierFor(rp).id } : {}) };
    });
    const body = JSON.stringify({ code: this.room.code, status, players, ranked: Boolean(this.room.ranked && this.room.ranked.gameId === this.room.gameId) });
    const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName("global"));
    stub.fetch(new Request("https://matchmaker.internal/api/card-battle/matchmaking/live", { method: "POST", body })).catch(error => console.error("Live list update failed", error));
  }

  maybeStart() {
    const [a, b] = this.room.seats;
    if (!a?.deck || !b?.deck || this.room.phase === "playing") return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.room.game = createGame({ decks: [a.deck, b.deck], names: [a.name, b.name], seed });
    this.room.phase = "playing";
    this.room.rematch = [false, false];
    this.room.timeouts = [0, 0];
    this.room.lastEvents = [];
    this.room.gameId = crypto.randomUUID();
    this.room.paid = [false, false];
    // Only the first game between the two matched accounts is ranked; rematches aren't.
    const ranked = this.room.ranked;
    if (ranked && !ranked.gameId && [a.userId, b.userId].every(id => ranked.users.includes(id)) && a.userId !== b.userId) ranked.gameId = this.room.gameId;
    this.reportLive("playing");
    this.setTurnDeadline();
  }

  // Logged-in players can only bring cards they own (shiny flags too).
  async checkOwnership(seat, entries) {
    const userId = this.room.seats[seat]?.userId;
    if (!userId) return;
    const row = await this.env.DB.prepare(`SELECT data FROM profiles WHERE user_id = ?`).bind(userId).first();
    const profile = econ.normalizeProfile(row ? JSON.parse(row.data) : null);
    const need = {}, shiny = {};
    for (const e of entries) { need[e.id] = (need[e.id] || 0) + 1; if (e.shiny) shiny[e.id] = (shiny[e.id] || 0) + 1; }
    for (const [id, n] of Object.entries(need)) {
      if (econ.ownedCount(profile, id) < n) throw new Error("Your deck has cards you don't own. Fix it in My Decks.");
      if ((shiny[id] || 0) > (profile.cards[id]?.s || 0)) throw new Error("Your deck claims shinies you don't own.");
    }
  }

  // Pay match rewards to logged-in players. Each seat is marked paid only after its
  // payout succeeds (so a failure can be retried later), and the game id is recorded
  // in the player's profile so a retry can never pay twice.
  async payRewards() {
    if (this.paying) return this.paying;
    this.paying = (async () => {
      const game = this.room.game;
      if (!game?.over || !this.room.gameId) return;
      this.room.paid = this.room.paid || [false, false];
      const day = econ.utcDay();
      for (const seat of [0, 1]) {
        const userId = this.room.seats[seat]?.userId;
        if (!userId || this.room.paid[seat]) continue;
        const won = game.winner === seat;
        const gameId = this.room.gameId;
        try {
          const isRanked = this.room.ranked?.gameId === gameId;
          const out = await applyEconomy(this.env, userId, this.room.seats[seat].name, p => {
            if (p.paidGames.includes(gameId)) return { ok: true, coins: 0, already: true };
            p.paidGames = [...p.paidGames, gameId].slice(-30);
            const result = econ.recordResult(p, { won, reward: won ? econ.ONLINE_REWARD.win : econ.ONLINE_REWARD.loss, day, kind: "online", cap: econ.DAILY_REWARD_CAP.online });
            if (isRanked) result.rank = econ.recordRanked(p, { won, draw: game.winner === "draw" });
            return result;
          });
          if (!out.ok) continue;
          this.room.paid[seat] = true;
          await this.saveRoom();
          if (!out.result.already) {
            for (const [socket, session] of this.sessions.entries()) {
              if (session.seat === seat) this.send(socket, { type: "reward", coins: out.result.coins, firstWin: out.result.firstWin, capped: out.result.capped, rank: out.result.rank || null });
            }
          }
        } catch (error) {
          console.error("Reward payout failed; will retry", error);
        }
      }
    })().finally(() => { this.paying = null; });
    return this.paying;
  }

  retryRewards() {
    if (this.room.phase === "over" && this.room.paid && this.room.paid.includes(false)) this.payRewards().catch(() => {});
  }

  afterAction(events, turnBefore) {
    const game = this.room.game;
    if (game.over) { this.room.phase = "over"; this.room.deadline = 0; this.state.storage.deleteAlarm(); this.payRewards().catch(error => console.error("Reward payout failed", error)); this.reportLive("over"); }
    else if (game.turn !== turnBefore) this.setTurnDeadline();
    this.broadcast(events);
  }

  setTurnDeadline() {
    this.room.deadline = Date.now() + TURN_SECONDS * 1000;
    this.state.storage.setAlarm(this.room.deadline);
  }

  async alarm() {
    await this.loadRoom("");
    const game = this.room.game;
    if (this.room.phase !== "playing" || !game || game.over) return;
    if (Date.now() < this.room.deadline - 1000) { this.state.storage.setAlarm(this.room.deadline); return; }
    const catalog = await this.getCatalog();
    const seat = game.active;
    this.room.timeouts[seat] += 1;
    const turnBefore = game.turn;
    const action = this.room.timeouts[seat] >= MAX_TIMEOUTS ? { type: "concede" } : { type: "end" };
    const result = applyAction(game, catalog, seat, action);
    if (result.ok) this.afterAction([{ t: "timeout", player: seat }, ...result.events], turnBefore);
    await this.saveRoom();
  }

  roomView() {
    return {
      code: this.room.code,
      phase: this.room.phase,
      deadline: this.room.deadline,
      rematch: this.room.rematch,
      ranked: Boolean(this.room.ranked) && (!this.room.game || this.room.ranked.gameId === this.room.gameId),
      watchers: this.watcherCount(),
      seats: this.room.seats.map(s => {
        if (!s) return null;
        const rp = s.userId && this.room.ranked ? this.room.ranked.ranks[s.userId] : undefined;
        return { name: s.name, hero: s.hero || "", connected: s.connected, ready: Boolean(s.deck), ...(rp !== undefined && rp !== null ? { tier: econ.tierFor(rp).id } : {}) };
      })
    };
  }

  broadcast(events = []) {
    const room = this.roomView();
    for (const [socket, session] of this.sessions.entries()) {
      const seat = session.seat;
      const viewer = seat === 0 || seat === 1 ? seat : -1;
      this.send(socket, {
        type: "state",
        seat,
        room,
        game: this.room.game ? viewFor(this.room.game, viewer) : null,
        events: eventsFor(events, viewer)
      });
    }
  }

  send(socket, payload) {
    try { socket.send(JSON.stringify(payload)); } catch (error) { console.error("WebSocket send failed", error); }
  }
}

// Quick match: one global queue. Players wait on a WebSocket; the matchmaker pairs
// them and both join the same fresh room like a friend's room. Logged-in players are
// paired by Rank Points, with the allowed gap widening the longer they wait. When both
// players are logged in the room is told the match is ranked before anyone joins.
const RANK_WINDOW = { base: 100, perSecond: 12 };

export class Matchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.waiting = [];
    this.timer = null;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/card-battle/matchmaking/live" && request.method === "POST") return this.updateLive(request);
    if (path === "/api/card-battle/live") {
      const games = Object.values(await this.liveGames()).sort((a, b) => b.started - a.started).slice(0, 20);
      return jsonResponse({ searching: this.waiting.length, games }, 200, NO_STORE_HEADERS);
    }
    if (request.headers.get("upgrade") !== "websocket") {
      return jsonResponse({ searching: this.waiting.length }, 200, NO_STORE_HEADERS);
    }
    const url = new URL(request.url);
    const token = cleanText(url.searchParams.get("token"), 64) || crypto.randomUUID();
    const account = await userFromToken(this.env, url.searchParams.get("auth"));
    const rp = account ? await rankPointsFor(this.env, account.id) : null;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // Same player searching from a second tab: drop the old ticket so they can't match themselves.
    for (const old of this.waiting.filter(w => w.token === token || (account && w.userId === account.id))) this.drop(old.socket, "Searching in another tab.");
    const entry = { socket: server, token, userId: account?.id || null, rp, joined: Date.now() };
    this.waiting.push(entry);

    const leave = () => { this.waiting = this.waiting.filter(w => w !== entry); this.announce(); this.schedule(); };
    server.addEventListener("close", leave);
    server.addEventListener("error", leave);
    server.addEventListener("message", () => this.send(server, { type: "pong" }));

    await this.pairUp();
    this.announce();
    this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Re-check every few seconds while two or more are waiting, since rank windows widen over time.
  schedule() {
    if (this.waiting.length >= 2 && !this.timer) this.timer = setInterval(() => this.pairUp().then(() => this.announce()).catch(console.error), 3000);
    if (this.waiting.length < 2 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  compatible(a, b, now) {
    if (a.rp === null || b.rp === null) return true;
    const window = w => RANK_WINDOW.base + RANK_WINDOW.perSecond * ((now - w.joined) / 1000);
    return Math.abs(a.rp - b.rp) <= Math.max(window(a), window(b));
  }

  async pairUp() {
    if (this.pairing) return;
    this.pairing = true;
    try {
      const now = Date.now();
      // Longest waiter first; pair them with the closest-ranked compatible player.
      for (let i = 0; i < this.waiting.length; i++) {
        const a = this.waiting[i];
        let best = null;
        for (const b of this.waiting.slice(i + 1)) {
          if (!this.compatible(a, b, now)) continue;
          const gap = a.rp === null || b.rp === null ? 0 : Math.abs(a.rp - b.rp);
          if (!best || gap < best.gap) best = { b, gap };
        }
        if (!best) continue;
        const b = best.b;
        this.waiting = this.waiting.filter(w => w !== a && w !== b);
        i -= 1;
        const roomCode = createRoomCode();
        const ranked = Boolean(a.userId && b.userId && a.userId !== b.userId);
        await this.setupRoom(roomCode, ranked ? { [a.userId]: a.rp, [b.userId]: b.rp } : null);
        for (const w of [a, b]) {
          this.send(w.socket, { type: "matched", roomCode, ranked });
          try { w.socket.close(1000, "Matched"); } catch { /* already closed */ }
        }
      }
    } finally {
      this.pairing = false;
      this.schedule();
    }
  }

  // Internal call only: the public worker route never forwards POSTs to rooms.
  async setupRoom(roomCode, ranks) {
    const stub = this.env.CARD_BATTLE_ROOMS.get(this.env.CARD_BATTLE_ROOMS.idFromName(roomCode));
    await stub.fetch(new Request(`https://rooms.internal/api/card-battle/${roomCode}/setup`, { method: "POST", body: JSON.stringify({ ranks }) }));
  }

  // Live matchmade games, kept in storage so the list survives the matchmaker going idle.
  async liveGames() {
    const live = (await this.state.storage.get("live")) || {};
    const now = Date.now();
    for (const [code, game] of Object.entries(live)) if (now - game.updated > LIVE_TTL_MS) delete live[code];
    return live;
  }

  async updateLive(request) {
    const body = await request.json().catch(() => ({}));
    const code = getRoomCodeFromPath(`/api/card-battle/${cleanText(body.code, 12)}`);
    if (!code) return jsonResponse({ ok: false }, 400, NO_STORE_HEADERS);
    const live = await this.liveGames();
    if (body.status === "playing") {
      const players = Array.isArray(body.players) ? body.players.slice(0, 2).map(p => ({ name: cleanText(p?.name, 24) || "?", ...(p?.tier ? { tier: cleanText(p.tier, 20) } : {}) })) : [];
      live[code] = { code, players, ranked: Boolean(body.ranked), started: live[code]?.started || Date.now(), updated: Date.now() };
    } else {
      delete live[code];
    }
    await this.state.storage.put("live", live);
    return jsonResponse({ ok: true }, 200, NO_STORE_HEADERS);
  }

  announce() {
    for (const w of this.waiting) this.send(w.socket, { type: "queue", searching: this.waiting.length });
  }

  drop(socket, reason) {
    this.waiting = this.waiting.filter(w => w.socket !== socket);
    this.send(socket, { type: "error", message: reason });
    try { socket.close(1000, reason); } catch { /* already closed */ }
  }

  send(socket, payload) {
    try { socket.send(JSON.stringify(payload)); } catch { /* socket gone */ }
  }
}

async function rankPointsFor(env, userId) {
  const row = await env.DB.prepare(`SELECT data FROM profiles WHERE user_id = ?`).bind(userId).first();
  return econ.normalizeProfile(row ? JSON.parse(row.data) : null).rank.rp;
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const out = { type: cleanText(action.type, 12) };
  if (typeof action.uid === "string") out.uid = cleanText(action.uid, 24);
  if (typeof action.target === "string") out.target = cleanText(action.target, 24);
  if (Number.isInteger(action.position)) out.position = action.position;
  if (Array.isArray(action.uids)) out.uids = action.uids.slice(0, 10).filter(u => typeof u === "string").map(u => cleanText(u, 24));
  return out;
}

async function createCardBattleRoom() {
  const roomCode = createRoomCode();
  return jsonResponse({ roomCode, url: `/goober-cards/?room=${roomCode}` }, 201, NO_STORE_HEADERS);
}

async function routeCardBattleRoom(request, env) {
  if (!env.CARD_BATTLE_ROOMS) return jsonResponse({ error: "Card battle rooms are not configured." }, 500, NO_STORE_HEADERS);
  const roomCode = getRoomCodeFromPath(new URL(request.url).pathname);
  if (!roomCode) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS);
  return env.CARD_BATTLE_ROOMS.get(env.CARD_BATTLE_ROOMS.idFromName(roomCode)).fetch(request);
}

async function routeMatchmaking(request, env) {
  if (!env.MATCHMAKER) return jsonResponse({ error: "Matchmaking is not configured." }, 500, NO_STORE_HEADERS);
  return env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global")).fetch(request);
}

const ALLOWED_CATEGORIES = new Set(["classic", "costume", "chaos", "funny", "spooky", "animal", "food", "sports", "holiday", "fancy", "superhero", "random"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const NO_STORE_HEADERS = { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "pragma": "no-cache", "expires": "0", "surrogate-control": "no-store", "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" };
function createRoomCode() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = ""; const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); for (const byte of bytes) code += alphabet[byte % alphabet.length]; return code; }
function getRoomCodeFromPath(pathname) { const match = pathname.match(/^\/api\/card-battle\/([A-Z0-9]{4,12})(?:\/socket|\/setup)?$/i); return match ? match[1].toUpperCase() : ""; }
async function listGoobers(env) { const result = await env.DB.prepare(`SELECT id, name, category, description, image_key, image_type, created_at FROM goobers WHERE approved = 1 ORDER BY created_at DESC`).all(); return jsonResponse((result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}`, createdAt: row.created_at })), 200, NO_STORE_HEADERS); }
async function uploadGoober(request, env) {
  const formData = await request.formData();
  const name = cleanText(formData.get("name"), 80), category = cleanText(formData.get("category"), 30), description = cleanText(formData.get("description"), 280), image = formData.get("image");
  // Uploads need a Goober Cards account. The auto-mod checks every upload, and each
  // account and each network gets a daily cap so nobody can flood the gallery.
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: "Log in to your Goober Cards account to add a Goober.", needsLogin: true }, 401, NO_STORE_HEADERS);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  if (!name) return jsonResponse({ error: "Goober name is required." }, 400, NO_STORE_HEADERS);
  if (!description) return jsonResponse({ error: "Goober description is required." }, 400, NO_STORE_HEADERS);
  if (!ALLOWED_CATEGORIES.has(category)) return jsonResponse({ error: "Invalid category." }, 400, NO_STORE_HEADERS);
  if (!(image instanceof File)) return jsonResponse({ error: "Image file is required." }, 400, NO_STORE_HEADERS);
  if (image.size > MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large. Max size is 5 MB." }, 400, NO_STORE_HEADERS);

  // Reserve a slot atomically (so parallel requests can't sneak past the cap).
  // Blocked uploads still use up a slot.
  if (await bumpDailyCount(env, "upload_counts", `user:${user.id}`, day) > MAX_UPLOADS_PER_ACCOUNT) return jsonResponse({ error: `That's ${MAX_UPLOADS_PER_ACCOUNT} uploads today on your account. Come back tomorrow!` }, 429, NO_STORE_HEADERS);
  if (await bumpDailyCount(env, "upload_counts", ip, day) > MAX_UPLOADS_PER_DAY) return jsonResponse({ error: `That's ${MAX_UPLOADS_PER_DAY} uploads today from here. Come back tomorrow!` }, 429, NO_STORE_HEADERS);

  // Trust the file's bytes, not its claimed type: only plain raster images (no SVG/HTML).
  const bytes = new Uint8Array(await image.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return jsonResponse({ error: "Only JPG, PNG, WebP, or GIF images, please." }, 400, NO_STORE_HEADERS);
  const moderation = await moderateUpload(env, { name, description, category, bytes, type: kind.type });
  if (moderation.verdict === "block") {
    console.log("Upload blocked by auto-mod", { name, uploader: user.username, reason: moderation.reason });
    return jsonResponse({ error: `Auto-mod blocked this Goober: ${moderation.reason}`, moderation: "blocked", reason: moderation.reason }, 422, NO_STORE_HEADERS);
  }

  const approved = moderation.verdict === "allow" ? 1 : PENDING_REVIEW;
  const id = crypto.randomUUID(), extension = kind.ext, imageKey = `goobers/${id}.${extension}`;
  await env.GOOBER_IMAGES.put(imageKey, bytes, { httpMetadata: { contentType: kind.type }, customMetadata: { originalName: image.name || "goober-upload", gooberName: name, uploaderId: String(user.id), uploader: user.username, moderation: moderation.verdict, moderationReason: moderation.reason.slice(0, 200) } });
  await env.DB.prepare(`INSERT INTO goobers (id, name, category, description, image_key, image_type, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(id, name, category, description, imageKey, kind.type, approved).run();
  // The uploader doesn't get the card for free: remember it so they can craft it at the creator price.
  const imageUrl = `/api/goober-image/${imageKey}`;
  const card = cardFromGoober({ id, name, category, description, imageUrl });
  try { await applyEconomy(env, user.id, user.username, p => econ.recordCreation(p, id)); }
  catch (error) { console.error("Couldn't record the creator for an upload", error); }
  const creatorCost = Math.round((econ.CRAFT_COST[card.rarity] * econ.CREATOR_DISCOUNT) / 5) * 5;
  const body = { id, name, category, description, imageUrl, moderation: approved === 1 ? "approved" : "pending", reason: moderation.reason, card: { id: card.id, rarity: card.rarity, craftCost: econ.CRAFT_COST[card.rarity], creatorCost } };
  return jsonResponse(body, approved === 1 ? 201 : 202, NO_STORE_HEADERS);
}

// --- Auto-moderation ---------------------------------------------------------
// approved: 1 = live, 0 = deleted, 2 = waiting for a human to review.
const PENDING_REVIEW = 2;
const SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Identify an image from its first bytes. Returns null for anything else (SVG, HTML, ...).
function sniffImage(bytes) {
  const b = i => bytes[i];
  if (bytes.length < 12) return null;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return { type: "image/png", ext: "png" };
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return { type: "image/gif", ext: "gif" };
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}

// Atomically add one to a per-network daily counter and return the new total.
async function bumpDailyCount(env, table, ip, day) {
  const row = await env.DB.prepare(`INSERT INTO ${table} (ip, day, count) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET count = count + 1 RETURNING count`).bind(ip, day).first();
  return Number(row?.count) || 1;
}
const MAX_UPLOADS_PER_DAY = 8;
const MAX_UPLOADS_PER_ACCOUNT = 5;
const MODERATION_IMAGE_LIMIT = 3.5 * 1024 * 1024;
const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const TEXT_GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
const GUARD_CATEGORIES = { S1: "violent crime", S2: "crime", S3: "sexual crime", S4: "child safety", S5: "defamation", S6: "dangerous advice", S7: "private info", S8: "IP", S9: "weapons", S10: "hate", S11: "self-harm", S12: "sexual content", S13: "elections", S14: "code abuse" };
const MODERATION_PROMPT = `You moderate uploads for a website where middle schoolers (ages 11-14) share hand-drawn cartoon dogs called "Goobers". Each upload becomes a trading card in a funny meme card game.

ALLOW: silly or chaotic drawings, meme references, cartoon slapstick, cartoon weapons like swords or water guns, mild gross-out humor (farts, burps, boogers), spooky or monster themes, playful trash talk, mild words like "dumb", "butt", "sus".
BLOCK anything with: nudity or sexual content or innuendo; slurs, hate speech, or hate symbols; graphic gore or realistic violence; drugs, alcohol, vaping, or smoking; self-harm or suicide; swear words (including censored or misspelled ones); real people's photos or faces; personal info such as full names, addresses, phone numbers, school names, or social handles; bullying aimed at a real person.
REVIEW if you truly cannot tell, or if the image is not a drawing at all (for example a screenshot or a photo).

Judge the image AND the name and description together. Reply with JSON only: {"verdict":"allow"|"review"|"block","reason":"short kid-friendly reason"}`;

async function moderateUpload(env, { name, description, category, bytes, type }) {
  if (!env.AI) return { verdict: "review", reason: "Auto-mod isn't set up, so a human mod will check this one." };
  try {
    const text = `Name: ${name}\nCategory: ${category}\nDescription: ${description}`;
    const guard = await env.AI.run(TEXT_GUARD_MODEL, { messages: [{ role: "user", content: text }] });
    const guardResult = parseGuard(guard?.response);
    if (!guardResult.safe) return { verdict: "block", reason: `The name or description isn't allowed (${guardResult.categories.map(c => GUARD_CATEGORIES[c] || c).join(", ") || "unsafe"}).` };

    if (bytes.length > MODERATION_IMAGE_LIMIT) return { verdict: "review", reason: "Image is too big for auto-mod, so a human mod will check it." };
    const dataUrl = `data:${type || "image/jpeg"};base64,${toBase64(bytes)}`;
    const result = await env.AI.run(VISION_MODEL, {
      messages: [
        { role: "system", content: MODERATION_PROMPT },
        { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: dataUrl } }] }
      ],
      response_format: { type: "json_object" },
      max_tokens: 120,
      temperature: 0
    });
    const parsed = parseVerdict(result?.response);
    if (!parsed) return { verdict: "review", reason: "Auto-mod wasn't sure, so a human mod will check it." };
    return parsed;
  } catch (error) {
    console.error("Auto-mod failed", error);
    return { verdict: "review", reason: "Auto-mod had a hiccup, so a human mod will check it." };
  }
}

function parseGuard(response) {
  if (response && typeof response === "object") return { safe: response.safe !== false, categories: response.categories || [] };
  const textValue = String(response || "").trim().toLowerCase();
  if (!textValue || textValue.startsWith("safe")) return { safe: true, categories: [] };
  return { safe: false, categories: (String(response).match(/S\d+/g) || []) };
}

function parseVerdict(response) {
  let data = response;
  if (typeof data === "string") {
    const match = data.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { data = JSON.parse(match[0]); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const verdict = String(data.verdict || "").toLowerCase();
  if (!["allow", "review", "block"].includes(verdict)) return null;
  return { verdict, reason: cleanText(String(data.reason || ""), 160) || (verdict === "allow" ? "Looks good." : "Not allowed on this site.") };
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function listPendingGoobers(request, env) {
  if (!hasValidAdminCode(cleanText(request.headers.get("x-goober-admin-code"), 120), env)) return jsonResponse({ error: "Invalid admin code." }, 403, NO_STORE_HEADERS);
  const result = await env.DB.prepare(`SELECT id, name, category, description, image_key, created_at FROM goobers WHERE approved = ? ORDER BY created_at ASC`).bind(PENDING_REVIEW).all();
  return jsonResponse((result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}`, createdAt: row.created_at })), 200, NO_STORE_HEADERS);
}

async function approveGoober(request, env) {
  const id = decodeURIComponent(new URL(request.url).pathname.replace("/api/goobers/", "").replace(/\/approve$/, "")).trim();
  if (!id || id.includes("/") || id.includes("..")) return jsonResponse({ error: "Invalid goober id." }, 400, NO_STORE_HEADERS);
  if (!hasValidAdminCode(await readAdminCode(request), env)) return jsonResponse({ error: "Invalid admin code." }, 403, NO_STORE_HEADERS);
  const row = await env.DB.prepare(`SELECT id FROM goobers WHERE id = ? AND approved = ?`).bind(id, PENDING_REVIEW).first();
  if (!row) return jsonResponse({ error: "No pending Goober with that id." }, 404, NO_STORE_HEADERS);
  await env.DB.prepare(`UPDATE goobers SET approved = 1 WHERE id = ?`).bind(id).run();
  return jsonResponse({ ok: true, id, approved: true }, 200, NO_STORE_HEADERS);
}
async function deleteGoober(request, env) { const url = new URL(request.url), id = decodeURIComponent(url.pathname.replace("/api/goobers/", "")).trim(); if (!id || id.includes("/") || id.includes("..")) return jsonResponse({ error: "Invalid goober id." }, 400, NO_STORE_HEADERS); const adminCode = await readAdminCode(request); if (!hasValidAdminCode(adminCode, env)) return jsonResponse({ error: "Invalid admin delete code." }, 403, NO_STORE_HEADERS); const row = await env.DB.prepare(`SELECT id, image_key FROM goobers WHERE id = ?`).bind(id).first(); if (!row) return jsonResponse({ error: "Goober not found." }, 404, NO_STORE_HEADERS); await env.DB.prepare(`UPDATE goobers SET approved = 0 WHERE id = ?`).bind(id).run(); try { if (row.image_key) await env.GOOBER_IMAGES.delete(row.image_key); } catch (error) { console.error("R2 image delete failed after DB soft delete", error); } return jsonResponse({ ok: true, id, deleted: true }, 200, NO_STORE_HEADERS); }
async function readAdminCode(request) { const headerCode = cleanText(request.headers.get("x-goober-admin-code"), 120); if (headerCode) return headerCode; const contentType = request.headers.get("content-type") || ""; if (contentType.includes("application/json")) { const body = await request.json().catch(() => ({})); return cleanText(body.adminCode, 120); } if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) { const formData = await request.formData().catch(() => null); return cleanText(formData?.get("adminCode"), 120); } return ""; }
function hasValidAdminCode(code, env) { const expected = cleanText(env.GOOBER_ADMIN_CODE || env.GOOBER_UPLOAD_CODE, 120); return Boolean(expected && code && safeEqual(code, expected)); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
async function getGooberImage(request, env) { const url = new URL(request.url), imageKey = decodeURIComponent(url.pathname.replace("/api/goober-image/", "")); if (!imageKey || imageKey.includes("..") || !imageKey.startsWith("goobers/")) return jsonResponse({ error: "Invalid image key." }, 400, NO_STORE_HEADERS); const object = await env.GOOBER_IMAGES.get(imageKey); if (!object) return jsonResponse({ error: "Image not found" }, 404, NO_STORE_HEADERS); const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=31536000, immutable");
  // Uploads are only ever displayed as images: no scripts, no sniffing, and anything that
  // isn't a known raster type (e.g. an old SVG) is served as a download instead.
  headers.set("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  headers.set("x-content-type-options", "nosniff");
  if (!SAFE_IMAGE_TYPES.has((headers.get("content-type") || "").split(";")[0].trim().toLowerCase())) {
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
  }
  return new Response(object.body, { headers }); }
function cleanText(value, maxLength) { if (typeof value !== "string") return ""; return value.trim().replace(/\s+/g, " ").slice(0, maxLength); }
function jsonResponse(data, status = 200, headers = {}) { return corsResponse(JSON.stringify(data), status, { "content-type": "application/json; charset=utf-8", ...headers }); }
function corsResponse(body, status = 200, headers = {}) { return new Response(body, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "content-type, authorization, x-goober-admin-code, cache-control, pragma", ...headers } }); }

// --- Accounts ------------------------------------------------------------------
// Username + password logins (no email). Passwords: PBKDF2-SHA256 with a random
// salt. Sessions: a random bearer token; only its SHA-256 is stored.
const PBKDF2_ITERATIONS = 100000;
const SESSION_DAYS = 90;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_SIGNUPS_PER_DAY = 10;
const MAX_LOGIN_TRIES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED_NAMES = new Set(["admin", "administrator", "mod", "moderator", "goober", "system", "support", "npc", "tryhard", "finalboss"]);

async function routeAccounts(request, env, url) {
  try {
    return await handleAccounts(request, env, url);
  } catch (error) {
    if (error.message === "Request is too big.") return jsonResponse({ error: "Save data is too big." }, 413, NO_STORE_HEADERS);
    if (error.message === "Invalid request.") return jsonResponse({ error: "Invalid request." }, 400, NO_STORE_HEADERS);
    throw error;
  }
}

async function handleAccounts(request, env, url) {
  const path = url.pathname, method = request.method;
  if (path === "/api/auth/signup" && method === "POST") return signup(request, env);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/auth/me" && method === "GET") {
    const user = await requireUser(request, env);
    return user ? jsonResponse({ user: publicUser(user) }, 200, NO_STORE_HEADERS) : unauthorized();
  }
  if (path === "/api/profile" && method === "GET") return getProfile(request, env);
  if (path === "/api/profile" && method === "PUT") return putProfile(request, env);
  if (path.startsWith("/api/econ/") && method === "POST") return econAction(request, env, url);
  return jsonResponse({ error: "Not found" }, 404, NO_STORE_HEADERS);
}

function unauthorized() { return jsonResponse({ error: "Please log in again." }, 401, NO_STORE_HEADERS); }
function publicUser(user) { return { id: user.id, username: user.username }; }

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_PROFILE_BYTES + 1024) throw new Error("Request is too big.");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("Invalid request."); }
}

function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function unhex(text) { const out = new Uint8Array(text.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16); return out; }

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}

async function sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); }

async function createSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`).bind(await sha256Hex(token), userId, expires).run();
  return token;
}

async function requireUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(`SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(await sha256Hex(token)).first();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

function validateCredentials(body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME_RE.test(username)) return { error: "Usernames are 3-20 letters, numbers, or underscores." };
  if (password.length < 6) return { error: "Passwords need at least 6 characters." };
  if (password.length > 200) return { error: "That password is way too long." };
  return { username, password, key: username.toLowerCase() };
}

// Keep gamertags clean. Fails open (allows) if the AI is unavailable.
async function usernameAllowed(env, username) {
  if (RESERVED_NAMES.has(username.toLowerCase())) return { ok: false, reason: "That name is reserved." };
  if (!env.AI) return { ok: true };
  try {
    const guard = await env.AI.run(TEXT_GUARD_MODEL, { messages: [{ role: "user", content: `Gamer tag: ${username}` }] });
    if (!parseGuard(guard?.response).safe) return { ok: false, reason: "Pick a different username." };
    const result = await env.AI.run(VISION_MODEL, {
      messages: [
        { role: "system", content: 'You check gamer tags for a game played by middle schoolers. Block swear words (including misspelled, spaced, or leetspeak versions), sexual words, slurs, drug references, and real full names. Silly or meme names are fine. Reply with JSON only: {"ok":true|false}' },
        { role: "user", content: username }
      ],
      response_format: { type: "json_object" }, max_tokens: 20, temperature: 0
    });
    let data = result?.response;
    if (typeof data === "string") { const m = data.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : {}; }
    return data && data.ok === false ? { ok: false, reason: "Pick a different username." } : { ok: true };
  } catch (error) {
    console.error("Username check failed", error);
    return { ok: true };
  }
}

async function signup(request, env) {
  const body = await readJson(request);
  const creds = validateCredentials(body);
  if (creds.error) return jsonResponse({ error: creds.error }, 400, NO_STORE_HEADERS);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  if (await bumpDailyCount(env, "signup_counts", ip, day) > MAX_SIGNUPS_PER_DAY) return jsonResponse({ error: "Too many new accounts from here today. Try tomorrow." }, 429, NO_STORE_HEADERS);
  const taken = await env.DB.prepare(`SELECT id FROM users WHERE username_key = ?`).bind(creds.key).first();
  if (taken) return jsonResponse({ error: "That username is taken." }, 409, NO_STORE_HEADERS);
  const allowed = await usernameAllowed(env, creds.username);
  if (!allowed.ok) return jsonResponse({ error: allowed.reason }, 422, NO_STORE_HEADERS);

  const id = crypto.randomUUID();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(creds.password, salt);
  try {
    await env.DB.prepare(`INSERT INTO users (id, username, username_key, pass_hash, pass_salt) VALUES (?, ?, ?, ?, ?)`).bind(id, creds.username, creds.key, hash, salt).run();
  } catch (error) {
    return jsonResponse({ error: "That username is taken." }, 409, NO_STORE_HEADERS);
  }
  // Start the account with the player's current device progress, if sent.
  const start = body.profile && typeof body.profile === "object" && JSON.stringify(body.profile).length <= MAX_PROFILE_BYTES
    ? econ.importGuestProfile(body.profile, await loadCatalog(env))
    : econ.freshProfile();
  start.name = creds.username;
  await env.DB.prepare(`INSERT INTO profiles (user_id, data, version) VALUES (?, ?, 1)`).bind(id, JSON.stringify(start)).run();
  const token = await createSession(env, id);
  return jsonResponse({ token, user: { id, username: creds.username } }, 201, NO_STORE_HEADERS);
}

async function login(request, env) {
  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const key = username.toLowerCase();
  if (!username || !password) return jsonResponse({ error: "Enter your username and password." }, 400, NO_STORE_HEADERS);
  // Every attempt is counted atomically before the password is checked, so a burst of
  // parallel guesses can't all read the same count. 5 tries per 15-minute window;
  // a correct password clears the counter.
  const now = Date.now();
  const attempt = await env.DB.prepare(`INSERT INTO login_attempts (username_key, failures, locked_until) VALUES (?1, 1, ?2 + ?3)
    ON CONFLICT(username_key) DO UPDATE SET
      failures = CASE WHEN locked_until <= ?2 THEN 1 ELSE failures + 1 END,
      locked_until = CASE WHEN locked_until <= ?2 THEN ?2 + ?3 ELSE locked_until END
    RETURNING failures, locked_until`).bind(key, now, LOGIN_WINDOW_MS).first();
  if (attempt && attempt.failures > MAX_LOGIN_TRIES) {
    const wait = Math.max(1, Math.ceil((attempt.locked_until - now) / 60000));
    return jsonResponse({ error: `Too many tries. Wait ${wait} minute${wait === 1 ? "" : "s"}.` }, 429, NO_STORE_HEADERS);
  }
  const user = await env.DB.prepare(`SELECT id, username, pass_hash, pass_salt FROM users WHERE username_key = ?`).bind(key).first();
  // Hash even when the user doesn't exist so timing doesn't reveal usernames.
  const hash = await hashPassword(password, user?.pass_salt || "00000000000000000000000000000000");
  if (!user || !safeEqual(hash, user.pass_hash)) return jsonResponse({ error: "Wrong username or password." }, 401, NO_STORE_HEADERS);
  await env.DB.prepare(`DELETE FROM login_attempts WHERE username_key = ?`).bind(key).run();
  const token = await createSession(env, user.id);
  return jsonResponse({ token, user: publicUser(user) }, 200, NO_STORE_HEADERS);
}

async function logout(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (/^[0-9a-f]{64}$/.test(token)) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
  return jsonResponse({ ok: true }, 200, NO_STORE_HEADERS);
}

async function getProfile(request, env) {
  const user = await requireUser(request, env);
  if (!user) return unauthorized();
  const row = await env.DB.prepare(`SELECT data, version, updated_at FROM profiles WHERE user_id = ?`).bind(user.id).first();
  if (!row) return jsonResponse({ data: null, version: 0 }, 200, NO_STORE_HEADERS);
  return jsonResponse({ data: JSON.parse(row.data), version: row.version, updatedAt: row.updated_at }, 200, NO_STORE_HEADERS);
}

// A device can only change its decks, settings, and similar; coins, cards, and
// packs only change through the server's economy actions below.
async function putProfile(request, env) {
  const user = await requireUser(request, env);
  if (!user) return unauthorized();
  const body = await readJson(request);
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) return jsonResponse({ error: "Invalid save data." }, 400, NO_STORE_HEADERS);
  // `editsRev` counts deck/settings saves. A device saving on top of an older count
  // (say, a tab left open on another phone) is refused and gets the newer edits instead.
  const baseRev = body.editsRev === undefined ? null : Number(body.editsRev);
  const out = await applyEconomy(env, user.id, user.username, p => {
    if (baseRev !== null && baseRev !== p.editsRev) return { ok: false, conflict: true, error: "Your decks were changed on another device." };
    const merged = econ.mergeClientEdits(p, body.data, { username: user.username });
    for (const key of Object.keys(p)) delete p[key];
    Object.assign(p, merged, { editsRev: merged.editsRev + 1 });
    return { ok: true };
  });
  if (!out.ok) return jsonResponse({ error: out.result?.error, conflict: Boolean(out.result?.conflict), profile: out.profile, version: out.version }, 409, NO_STORE_HEADERS);
  return jsonResponse({ ok: true, version: out.version, profile: out.profile }, 200, NO_STORE_HEADERS);
}

// --- Server-side economy -----------------------------------------------------------
let catalogCache = { at: 0, catalog: null };
async function loadCatalog(env, { fresh = false } = {}) {
  if (!fresh && catalogCache.catalog && Date.now() - catalogCache.at < 60_000) return catalogCache.catalog;
  let goobers = [];
  try {
    const result = await env.DB.prepare(`SELECT id, name, category, description, image_key FROM goobers WHERE approved = 1`).all();
    goobers = (result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}` }));
  } catch (error) { console.error("Catalog load failed", error); }
  catalogCache = { at: Date.now(), catalog: buildCatalog(goobers) };
  return catalogCache.catalog;
}

// Read-modify-write a player's profile with optimistic locking (retries on a race).
async function applyEconomy(env, userId, username, change) {
  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 25 * Math.min(attempt, 6)));
    const row = await env.DB.prepare(`SELECT data, version FROM profiles WHERE user_id = ?`).bind(userId).first();
    const profile = econ.normalizeProfile(row ? JSON.parse(row.data) : null);
    if (!row) profile.name = username;
    const result = await change(profile);
    if (!result?.ok) return { ok: false, result, profile, version: row?.version || 0 };
    const data = JSON.stringify(profile);
    if (data.length > MAX_PROFILE_BYTES) return { ok: false, result: { ok: false, error: "Save data is too big." }, profile, version: row?.version || 0 };
    if (!row) {
      const ins = await env.DB.prepare(`INSERT INTO profiles (user_id, data, version) VALUES (?, ?, 1) ON CONFLICT(user_id) DO NOTHING`).bind(userId, data).run();
      if (ins.meta?.changes) return { ok: true, result, profile, version: 1 };
      continue;
    }
    const upd = await env.DB.prepare(`UPDATE profiles SET data = ?, version = version + 1, updated_at = datetime('now') WHERE user_id = ? AND version = ?`).bind(data, userId, row.version).run();
    if (upd.meta?.changes) return { ok: true, result, profile, version: row.version + 1 };
  }
  throw new Error("Your account is busy. Try again.");
}

async function econAction(request, env, url) {
  const user = await requireUser(request, env);
  if (!user) return unauthorized();
  const body = request.method === "POST" ? await readJson(request) : {};
  const action = url.pathname.replace("/api/econ/", "");
  const day = econ.utcDay();
  const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  let change;
  switch (action) {
    case "daily": change = p => econ.claimDaily(p, day); break;
    case "buy": change = p => econ.buyPack(p, cleanText(body.type, 20)); break;
    case "open": { const catalog = await loadCatalog(env); change = p => econ.openPack(p, cleanText(body.type, 20), catalog, rng); break; }
    case "craft": {
      const id = cleanText(body.id, 80);
      // A Goober approved in the last minute may not be in this worker's cached catalog yet.
      let catalog = await loadCatalog(env);
      if (!catalog[id]) catalog = await loadCatalog(env, { fresh: true });
      change = p => econ.craftCard(p, id, catalog);
      break;
    }
    case "recycle": { const catalog = await loadCatalog(env); change = p => econ.recycleExtras(p, catalog); break; }
    case "solo-start": {
      const level = cleanText(body.level, 20);
      if (!econ.SOLO_REWARD[level]) return jsonResponse({ error: "Unknown opponent." }, 400, NO_STORE_HEADERS);
      const ticket = crypto.randomUUID();
      change = p => { p.openMatch = { id: ticket, level, started: Date.now() }; return { ok: true, ticket }; };
      break;
    }
    case "solo-finish": {
      const ticket = cleanText(body.ticket, 64), won = body.won === true, draw = body.draw === true;
      change = p => {
        const match = p.openMatch;
        if (!match || match.id !== ticket) return { ok: false, error: "No match to finish." };
        p.openMatch = null;
        // Too-quick "wins" still count as played, but pay nothing.
        const legit = Date.now() - match.started >= econ.MIN_SOLO_MATCH_MS;
        const reward = !legit ? 0 : won ? econ.SOLO_REWARD[match.level] : draw ? 20 : 15;
        return econ.recordResult(p, { won: won && legit, reward, day, kind: "solo", cap: econ.DAILY_REWARD_CAP.solo });
      };
      break;
    }
    default: return jsonResponse({ error: "Not found" }, 404, NO_STORE_HEADERS);
  }
  let out;
  try { out = await applyEconomy(env, user.id, user.username, change); }
  catch { return jsonResponse({ error: "Your account is busy. Try again." }, 503, NO_STORE_HEADERS); }
  if (!out.ok) return jsonResponse({ error: out.result?.error || "That didn't work.", profile: out.profile, version: out.version }, 400, NO_STORE_HEADERS);
  return jsonResponse({ ok: true, result: out.result, profile: out.profile, version: out.version }, 200, NO_STORE_HEADERS);
}

async function userFromToken(env, token) {
  token = typeof token === "string" ? token.trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    const row = await env.DB.prepare(`SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(await sha256Hex(token)).first();
    return row && Date.parse(row.expires_at) >= Date.now() ? row : null;
  } catch { return null; }
}
