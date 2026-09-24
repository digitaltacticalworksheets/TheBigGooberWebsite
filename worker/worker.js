import { buildCatalog, validateDeck } from "../public/goober-cards/cards.js";
import { createGame, applyAction, viewFor, eventsFor } from "../public/goober-cards/engine.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return corsResponse(null, 204);
      if (url.pathname === "/api/goobers" && request.method === "GET") return await listGoobers(env);
      if (url.pathname === "/api/goobers" && request.method === "POST") return await uploadGoober(request, env);
      if (url.pathname === "/api/card-battle/create" && request.method === "POST") return await createCardBattleRoom();
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

// One online Goober Cards match. The room is authoritative: clients send actions,
// the shared engine validates and applies them, and each seat gets its own view.
export class CardBattleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.room = null;
    this.catalog = null;
    this.catalogLoadedAt = 0;
  }

  emptyRoom(code) {
    return { code, phase: "lobby", seats: [null, null], game: null, deadline: 0, timeouts: [0, 0], rematch: [false, false], created: Date.now() };
  }

  async loadRoom(code) {
    if (this.room) return;
    this.room = (await this.state.storage.get("room2")) || this.emptyRoom(code);
  }

  async saveRoom() { await this.state.storage.put("room2", this.room); }

  async getCatalog() {
    if (this.catalog && Date.now() - this.catalogLoadedAt < 60_000) return this.catalog;
    let goobers = [];
    try {
      const result = await this.env.DB.prepare(`SELECT id, name, category, description, image_key FROM goobers WHERE approved = 1`).all();
      goobers = (result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}` }));
    } catch (error) { console.error("Catalog load failed", error); }
    this.catalog = buildCatalog(goobers);
    this.catalogLoadedAt = Date.now();
    return this.catalog;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = getRoomCodeFromPath(url.pathname);
    if (!code) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS);
    await this.loadRoom(code);
    if (request.headers.get("upgrade") !== "websocket") {
      return jsonResponse({ code, phase: this.room.phase, players: this.room.seats.map(s => (s ? { name: s.name, connected: s.connected } : null)) }, 200, NO_STORE_HEADERS);
    }

    const token = cleanText(url.searchParams.get("token"), 64);
    const name = cleanText(url.searchParams.get("name"), 24) || "Goober Fan";
    const hero = cleanText(url.searchParams.get("hero"), 80);
    let seat = this.room.seats.findIndex(s => s && token && s.token === token);
    if (seat < 0 && token) seat = this.room.seats.findIndex(s => !s);
    if (seat >= 0) {
      const prev = this.room.seats[seat];
      this.room.seats[seat] = { ...(prev || { deck: null }), token, name, hero, connected: true };
      if (this.room.game) this.room.game.players[seat].name = name;
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
      }
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    await this.saveRoom();
    this.send(server, { type: "catalog", cards: await this.getCatalog() });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(socket, data) {
    let message;
    try { message = JSON.parse(data); } catch { throw new Error("Invalid room message."); }
    const session = this.sessions.get(socket);
    if (!session) throw new Error("Session not found.");
    const seat = session.seat;
    const isPlayer = seat === 0 || seat === 1;

    if (message.type === "ping") return this.send(socket, { type: "pong" });

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
        if (validateDeck(catalog, entries.map(e => e.id)).ok) this.room.seats[seat].deck = entries;
      }
      if (this.room.rematch[0] && this.room.rematch[1]) { this.room.phase = "lobby"; this.room.game = null; this.maybeStart(); }
    }
    await this.saveRoom();
    this.broadcast();
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
    this.setTurnDeadline();
  }

  afterAction(events, turnBefore) {
    const game = this.room.game;
    if (game.over) { this.room.phase = "over"; this.room.deadline = 0; this.state.storage.deleteAlarm(); }
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
      seats: this.room.seats.map(s => (s ? { name: s.name, hero: s.hero || "", connected: s.connected, ready: Boolean(s.deck) } : null))
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

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const out = { type: cleanText(action.type, 12) };
  if (typeof action.uid === "string") out.uid = cleanText(action.uid, 24);
  if (typeof action.target === "string") out.target = cleanText(action.target, 24);
  if (Number.isInteger(action.position)) out.position = action.position;
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

const ALLOWED_CATEGORIES = new Set(["classic", "costume", "chaos", "funny", "spooky", "animal", "food", "sports", "holiday", "fancy", "superhero", "random"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const NO_STORE_HEADERS = { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "pragma": "no-cache", "expires": "0", "surrogate-control": "no-store", "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" };
function createRoomCode() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = ""; const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); for (const byte of bytes) code += alphabet[byte % alphabet.length]; return code; }
function getRoomCodeFromPath(pathname) { const match = pathname.match(/^\/api\/card-battle\/([A-Z0-9]{4,12})(?:\/socket)?$/i); return match ? match[1].toUpperCase() : ""; }
async function listGoobers(env) { const result = await env.DB.prepare(`SELECT id, name, category, description, image_key, image_type, created_at FROM goobers WHERE approved = 1 ORDER BY created_at DESC`).all(); return jsonResponse((result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}`, createdAt: row.created_at })), 200, NO_STORE_HEADERS); }
async function uploadGoober(request, env) {
  const formData = await request.formData();
  const uploadCode = cleanText(formData.get("uploadCode"), 120), name = cleanText(formData.get("name"), 80), category = cleanText(formData.get("category"), 30), description = cleanText(formData.get("description"), 280), image = formData.get("image");
  if (!hasValidUploadCode(uploadCode, env)) return jsonResponse({ error: "Invalid upload code." }, 403, NO_STORE_HEADERS);
  if (!name) return jsonResponse({ error: "Goober name is required." }, 400, NO_STORE_HEADERS);
  if (!description) return jsonResponse({ error: "Goober description is required." }, 400, NO_STORE_HEADERS);
  if (!ALLOWED_CATEGORIES.has(category)) return jsonResponse({ error: "Invalid category." }, 400, NO_STORE_HEADERS);
  if (!(image instanceof File)) return jsonResponse({ error: "Image file is required." }, 400, NO_STORE_HEADERS);
  if (!image.type.startsWith("image/")) return jsonResponse({ error: "File must be an image." }, 400, NO_STORE_HEADERS);
  if (image.size > MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large. Max size is 5 MB." }, 400, NO_STORE_HEADERS);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const moderation = await moderateUpload(env, { name, description, category, bytes, type: image.type });
  if (moderation.verdict === "block") {
    console.log("Upload blocked by auto-mod", { name, reason: moderation.reason });
    return jsonResponse({ error: `Auto-mod blocked this Goober: ${moderation.reason}`, moderation: "blocked", reason: moderation.reason }, 422, NO_STORE_HEADERS);
  }

  const approved = moderation.verdict === "allow" ? 1 : PENDING_REVIEW;
  const id = crypto.randomUUID(), extension = getExtension(image.name, image.type), imageKey = `goobers/${id}.${extension}`;
  await env.GOOBER_IMAGES.put(imageKey, bytes, { httpMetadata: { contentType: image.type }, customMetadata: { originalName: image.name || "goober-upload", gooberName: name, moderation: moderation.verdict, moderationReason: moderation.reason.slice(0, 200) } });
  await env.DB.prepare(`INSERT INTO goobers (id, name, category, description, image_key, image_type, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(id, name, category, description, imageKey, image.type, approved).run();
  const body = { id, name, category, description, imageUrl: `/api/goober-image/${imageKey}`, moderation: approved === 1 ? "approved" : "pending", reason: moderation.reason };
  return jsonResponse(body, approved === 1 ? 201 : 202, NO_STORE_HEADERS);
}

// --- Auto-moderation ---------------------------------------------------------
// approved: 1 = live, 0 = deleted, 2 = waiting for a human to review.
const PENDING_REVIEW = 2;
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
function hasValidUploadCode(code, env) { const expected = cleanText(env.GOOBER_UPLOAD_CODE, 120); return Boolean(expected && code && safeEqual(code, expected)); }
function hasValidAdminCode(code, env) { const expected = cleanText(env.GOOBER_ADMIN_CODE || env.GOOBER_UPLOAD_CODE, 120); return Boolean(expected && code && safeEqual(code, expected)); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
async function getGooberImage(request, env) { const url = new URL(request.url), imageKey = decodeURIComponent(url.pathname.replace("/api/goober-image/", "")); if (!imageKey || imageKey.includes("..") || !imageKey.startsWith("goobers/")) return jsonResponse({ error: "Invalid image key." }, 400, NO_STORE_HEADERS); const object = await env.GOOBER_IMAGES.get(imageKey); if (!object) return jsonResponse({ error: "Image not found" }, 404, NO_STORE_HEADERS); const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=31536000, immutable"); return new Response(object.body, { headers }); }
function cleanText(value, maxLength) { if (typeof value !== "string") return ""; return value.trim().replace(/\s+/g, " ").slice(0, maxLength); }
function getExtension(filename = "", contentType = "") { const lower = filename.toLowerCase(); if (lower.endsWith(".png")) return "png"; if (lower.endsWith(".webp")) return "webp"; if (lower.endsWith(".gif")) return "gif"; if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg"; if (contentType.includes("png")) return "png"; if (contentType.includes("webp")) return "webp"; if (contentType.includes("gif")) return "gif"; return "jpg"; }
function jsonResponse(data, status = 200, headers = {}) { return corsResponse(JSON.stringify(data), status, { "content-type": "application/json; charset=utf-8", ...headers }); }
function corsResponse(body, status = 200, headers = {}) { return new Response(body, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, x-goober-admin-code, cache-control, pragma", ...headers } }); }
