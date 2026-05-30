export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return corsResponse(null, 204);
      }

      if (url.pathname === "/api/goobers" && request.method === "GET") {
        return await listGoobers(env);
      }

      if (url.pathname === "/api/goobers" && request.method === "POST") {
        return await uploadGoober(request, env);
      }

      if (url.pathname === "/api/card-battle/create" && request.method === "POST") {
        return await createCardBattleRoom(env);
      }

      if (url.pathname.startsWith("/api/card-battle/") && request.method === "GET") {
        return await routeCardBattleRoom(request, env);
      }

      if (url.pathname.startsWith("/api/goobers/") && request.method === "DELETE") {
        return await deleteGoober(request, env);
      }

      if (url.pathname.startsWith("/api/goober-image/") && request.method === "GET") {
        return await getGooberImage(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: error.message || "Server error" }, 500);
    }
  }
};

export class CardBattleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.room = this.createEmptyRoom();
  }

  createEmptyRoom() {
    return { roomCode: "", players: {}, scores: { p1: 0, p2: 0 }, round: 0, selectedStat: null, lastResult: "Waiting for players to join the Goober Cards room.", lastWinner: null, lastDamage: 0, lastEvent: null, knockout: false, status: "waiting" };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomCode = getRoomCodeFromPath(url.pathname);
    if (!roomCode) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS);
    await this.loadRoom(roomCode);
    if (request.headers.get("upgrade") !== "websocket") return jsonResponse({ error: "Expected WebSocket upgrade." }, 426, NO_STORE_HEADERS);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const requestedPlayer = url.searchParams.get("playerId") || url.searchParams.get("player");
    const playerId = this.assignPlayerId(requestedPlayer);
    const playerName = cleanText(url.searchParams.get("name"), 40) || `Player ${playerId === "p1" ? "1" : playerId === "p2" ? "2" : "Spectator"}`;
    server.accept();
    this.sessions.set(server, { playerId });
    this.room.players[playerId] = { ...(this.room.players[playerId] || {}), id: playerId, name: playerName, connected: true, hand: normalizeHand(this.room.players[playerId]?.hand || []), card: this.room.players[playerId]?.card ? addCardHealth(this.room.players[playerId].card) : null };
    this.updateStatus();
    await this.ensureHands();
    await this.saveRoom();

    server.addEventListener("message", async (event) => {
      await this.handleMessage(server, event.data).catch((error) => {
        console.error(error);
        this.send(server, { type: "error", message: error.message || "Room error." });
      });
    });

    server.addEventListener("close", async () => {
      const session = this.sessions.get(server);
      this.sessions.delete(server);
      if (session?.playerId && this.room.players[session.playerId]) {
        this.room.players[session.playerId].connected = false;
        this.updateStatus();
        await this.saveRoom();
        this.broadcastState();
      }
    });

    this.send(server, { type: "joined", roomCode, playerId });
    this.broadcastState();
    return new Response(null, { status: 101, webSocket: client });
  }

  async loadRoom(roomCode) {
    const stored = await this.state.storage.get("room");
    if (stored) {
      this.room = { ...this.createEmptyRoom(), ...stored, players: stored.players || {}, scores: stored.scores || { p1: 0, p2: 0 } };
      this.room.roomCode = this.room.roomCode || roomCode;
      for (const player of ["p1", "p2"]) {
        if (this.room.players[player]) {
          this.room.players[player].hand = normalizeHand(this.room.players[player].hand || []);
          this.room.players[player].card = this.room.players[player].card ? addCardHealth(this.room.players[player].card) : null;
        }
      }
      return;
    }
    this.room = this.createEmptyRoom();
    this.room.roomCode = roomCode;
    await this.saveRoom();
  }

  async saveRoom() { await this.state.storage.put("room", this.room); }

  assignPlayerId(requested) {
    if ((requested === "p1" || requested === "p2") && !this.room.players[requested]?.connected) return requested;
    if (!this.room.players.p1) return "p1";
    if (!this.room.players.p2) return "p2";
    if (!this.room.players.p2.connected) return "p2";
    if (!this.room.players.p1.connected) return "p1";
    return `spectator-${crypto.randomUUID().slice(0, 6)}`;
  }

  updateStatus() { this.room.status = Boolean(this.room.players.p1) && Boolean(this.room.players.p2) ? "ready" : "waiting"; }

  async ensureHands(force = false) {
    if (!this.room.players.p1 || !this.room.players.p2) return;
    const p1NeedsHand = force || !Array.isArray(this.room.players.p1.hand) || this.room.players.p1.hand.length === 0;
    const p2NeedsHand = force || !Array.isArray(this.room.players.p2.hand) || this.room.players.p2.hand.length === 0;
    if (!p1NeedsHand && !p2NeedsHand) return;
    const deck = await this.getDeck();
    const dealt = dealHands(deck, 3);
    if (p1NeedsHand) this.room.players.p1.hand = dealt.p1;
    if (p2NeedsHand) this.room.players.p2.hand = dealt.p2;
    if (force) {
      this.room.players.p1.card = null;
      this.room.players.p2.card = null;
      this.room.selectedStat = null;
      this.room.lastWinner = null;
      this.room.lastDamage = 0;
      this.room.lastEvent = "deal";
      this.room.knockout = false;
      this.room.lastResult = "Fresh hands dealt. Each player has three role-based Goober cards.";
    }
  }

  async getDeck() {
    try {
      const result = await this.env.DB.prepare(`SELECT id, name, category, description, image_key FROM goobers WHERE approved = 1 ORDER BY created_at DESC`).all();
      const deck = (result.results || []).map((row) => addCardHealth({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}` }));
      if (deck.length) return deck;
    } catch (error) { console.error("Could not load Goober deck", error); }
    return [addCardHealth({ id: "fallback-original-goober", name: "Original Goober", category: "classic", description: "The original loaf-sitting Goober.", imageUrl: "/assets/original-goober.jpg" })];
  }

  async handleMessage(socket, data) {
    let message;
    try { message = JSON.parse(data); } catch { throw new Error("Invalid room message."); }
    const session = this.sessions.get(socket);
    if (!session) throw new Error("Session not found.");

    if (message.type === "setName") {
      const name = cleanText(message.name, 40);
      if (name && this.room.players[session.playerId]) this.room.players[session.playerId].name = name;
    }

    if (message.type === "playCard") {
      if (!this.room.players[session.playerId] || session.playerId.startsWith("spectator")) throw new Error("Only Player 1 and Player 2 can play cards.");
      if (this.room.knockout) throw new Error("A Goober has been knocked out. Deal new hands before playing another card.");
      await this.ensureHands();
      const cardId = cleanText(message.cardId, 120);
      const hand = this.room.players[session.playerId].hand || [];
      const card = hand.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error("That card is not in your three-card hand.");
      this.room.players[session.playerId].card = addCardHealth(card);
      this.room.selectedStat = null;
      this.room.lastWinner = null;
      this.room.lastDamage = 0;
      this.room.lastEvent = "play";
      this.room.lastResult = `${this.room.players[session.playerId].name} played ${card.name}.`;
    }

    if (message.type === "roll") this.rollBattle();

    if (message.type === "newRound") {
      if (!this.room.knockout && this.room.players.p1?.card && this.room.players.p2?.card) throw new Error("New cards are locked until one Goober is knocked out.");
      await this.ensureHands(true);
    }

    if (message.type === "resetScore") {
      this.room.scores = { p1: 0, p2: 0 };
      this.room.round = 0;
      await this.ensureHands(true);
      this.room.lastEvent = "reset";
      this.room.lastResult = "Score reset. Fresh three-card hands were dealt.";
    }

    this.updateStatus();
    await this.saveRoom();
    this.broadcastState();
  }

  rollBattle() {
    const p1 = this.room.players.p1;
    const p2 = this.room.players.p2;
    if (this.room.knockout) throw new Error("A Goober has been knocked out. Deal new hands for the next round.");
    if (!p1?.card || !p2?.card) throw new Error("Both players need to play one card from their hand before attacking.");

    p1.card = addCardHealth(p1.card);
    p2.card = addCardHealth(p2.card);
    const battleStat = BATTLE_STATS[cryptoRandomInt(0, BATTLE_STATS.length - 1)];
    const matchup = getBattleMatchup(p1.card, p2.card, battleStat);
    const attackerId = matchup.winnerId;
    const defenderId = attackerId === "p1" ? "p2" : "p1";
    const attacker = this.room.players[attackerId];
    const defender = this.room.players[defenderId];
    const result = calculateAttack(attacker.card, defender.card, battleStat, matchup.margin);

    this.room.selectedStat = battleStat;
    this.room.round += 1;
    this.room.lastDamage = result.damage;

    if (result.dodge) {
      this.room.lastWinner = "tie";
      this.room.lastDamage = 0;
      this.room.lastEvent = "dodge";
      this.room.lastResult = `${battleStat} battle: ${attacker.card.name} won ${matchup.p1Score} to ${matchup.p2Score}, but ${defender.card.name} dodged the attack. No HP lost.`;
      return;
    }

    defender.card.hp = Math.max(0, defender.card.hp - result.damage);
    this.room.lastWinner = attackerId;
    this.room.lastEvent = result.crit ? "crit" : "hit";

    let resultText = `${battleStat} battle: ${attacker.name}'s ${attacker.card.name} won ${matchup.winnerScore} to ${matchup.loserScore}. ${attacker.card.name} used ${attacker.card.specialMove} and hit ${defender.card.name} for ${result.damage} HP${result.crit ? " with a critical goober bonk" : ""}.`;

    if (result.heal) {
      attacker.card.hp = Math.min(attacker.card.maxHp, attacker.card.hp + result.heal);
      this.room.lastEvent = "heal";
      resultText += ` ${attacker.card.name} healed ${result.heal} HP.`;
    }

    if (defender.card.hp <= 0) {
      this.room.knockout = true;
      this.room.scores[attackerId] += 1;
      this.room.lastEvent = "knockout";
      resultText += ` ${defender.card.name} is knocked out!`;
    }
    this.room.lastResult = resultText;
  }

  getPublicState() {
    return { type: "state", room: { roomCode: this.room.roomCode, players: this.room.players, scores: this.room.scores, round: this.room.round, selectedStat: this.room.selectedStat, lastResult: this.room.lastResult, lastWinner: this.room.lastWinner, lastDamage: this.room.lastDamage, lastEvent: this.room.lastEvent, knockout: this.room.knockout, status: this.room.status } };
  }

  broadcastState() { const payload = this.getPublicState(); for (const socket of this.sessions.keys()) this.send(socket, payload); }
  send(socket, payload) { try { socket.send(JSON.stringify(payload)); } catch (error) { console.error("WebSocket send failed", error); } }
}

const ALLOWED_CATEGORIES = new Set(["classic", "costume", "chaos", "funny", "spooky", "animal", "food", "sports", "holiday", "fancy", "superhero", "random"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CARD_STATS = ["HP", "Attack", "Defense", "Speed", "Luck"];
const BATTLE_STATS = ["Attack", "Defense", "Speed", "Luck"];
const ROLES = ["Tank", "Brawler", "Glass Cannon", "Trickster", "Healer", "Balanced"];
const ROLE_TEMPLATES = {
  Tank: { hp: [132, 156], attack: [18, 27], defense: [23, 32], speed: [4, 7], luck: [4, 9], move: "Loaf Wall" },
  Brawler: { hp: [106, 126], attack: [30, 40], defense: [14, 21], speed: [6, 10], luck: [5, 10], move: "Heavy Bonk" },
  "Glass Cannon": { hp: [72, 92], attack: [41, 54], defense: [6, 12], speed: [10, 15], luck: [8, 14], move: "Chaos Blast" },
  Trickster: { hp: [88, 108], attack: [24, 34], defense: [8, 15], speed: [13, 18], luck: [12, 20], move: "Silly Dodge" },
  Healer: { hp: [96, 118], attack: [17, 27], defense: [13, 21], speed: [6, 10], luck: [10, 16], move: "Snack Break" },
  Balanced: { hp: [98, 120], attack: [25, 35], defense: [13, 20], speed: [8, 12], luck: [7, 13], move: "Reliable Goob" }
};
const NO_STORE_HEADERS = { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "pragma": "no-cache", "expires": "0", "surrogate-control": "no-store", "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" };

async function createCardBattleRoom(env) { const roomCode = createRoomCode(); return jsonResponse({ roomCode, url: `/goober-cards/?room=${roomCode}` }, 201, NO_STORE_HEADERS); }
async function routeCardBattleRoom(request, env) { if (!env.CARD_BATTLE_ROOMS) return jsonResponse({ error: "Card battle rooms are not configured." }, 500, NO_STORE_HEADERS); const roomCode = getRoomCodeFromPath(new URL(request.url).pathname); if (!roomCode) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS); const id = env.CARD_BATTLE_ROOMS.idFromName(roomCode); return env.CARD_BATTLE_ROOMS.get(id).fetch(request); }
function createRoomCode() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = ""; const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); for (const byte of bytes) code += alphabet[byte % alphabet.length]; return code; }
function getRoomCodeFromPath(pathname) { const match = pathname.match(/^\/api\/card-battle\/([A-Z0-9]{4,12})(?:\/socket)?$/i); return match ? match[1].toUpperCase() : ""; }
function dealHands(deck, handSize = 3) { const pool = [...deck].map((card) => addCardHealth(card)); shuffle(pool); const needed = handSize * 2; while (pool.length < needed) pool.push(...deck.map((card) => addCardHealth(card))); return { p1: pool.slice(0, handSize), p2: pool.slice(handSize, handSize * 2) }; }
function normalizeHand(hand) { return Array.isArray(hand) ? hand.map((card) => addCardHealth(card)) : []; }
function addCardHealth(card) { const safeCard = card || { id: "fallback-original-goober", name: "Original Goober", category: "classic", description: "The original loaf-sitting Goober.", imageUrl: "/assets/original-goober.jpg" }; const maxHp = Number(safeCard.maxHp) || maxHpFor(safeCard); const hp = Number.isFinite(Number(safeCard.hp)) ? Math.max(0, Math.min(maxHp, Number(safeCard.hp))) : maxHp; const role = getRole(safeCard); return { ...safeCard, hp, maxHp, role, specialMove: ROLE_TEMPLATES[role]?.move || "Goober Move" }; }
function getBattleMatchup(p1Card, p2Card, battleStat) { const p1Stats = getCardStats(p1Card); const p2Stats = getCardStats(p2Card); const p1Score = Math.round(p1Stats[battleStat] + cryptoRandomFloat() * Math.max(2, p1Stats.Luck * 0.45)); const p2Score = Math.round(p2Stats[battleStat] + cryptoRandomFloat() * Math.max(2, p2Stats.Luck * 0.45)); let winnerId = p1Score >= p2Score ? "p1" : "p2"; if (p1Score === p2Score) winnerId = p1Stats.Speed >= p2Stats.Speed ? "p1" : "p2"; const winnerScore = winnerId === "p1" ? p1Score : p2Score; const loserScore = winnerId === "p1" ? p2Score : p1Score; return { winnerId, p1Score, p2Score, winnerScore, loserScore, margin: Math.abs(p1Score - p2Score) }; }
function calculateAttack(attacker, defender, battleStat = "Attack", margin = 0) { const a = getCardStats(attacker); const d = getCardStats(defender); const roll = cryptoRandomFloat() * 100; let dodgeChance = Math.min(28, d.Speed * 0.75 + d.Luck * 0.55); let critChance = Math.min(32, a.Luck * 1.2); if (battleStat === "Speed") dodgeChance += 4; if (battleStat === "Luck") critChance += 7; if (roll < dodgeChance) return { damage: 0, crit: false, dodge: true, heal: 0 }; const crit = roll > 100 - critChance; let statBonus = Math.round(margin * (battleStat === "Attack" ? 1.15 : battleStat === "Defense" ? 0.7 : battleStat === "Speed" ? 0.8 : 0.9)); let damage = Math.max(5, Math.round((a.Attack * 1.35 - d.Defense * 0.68 + 6 + statBonus) * (crit ? 1.75 : 1))); if (battleStat === "Defense") damage = Math.max(5, damage + Math.round(a.Defense * 0.25)); if (attacker.role === "Brawler") damage += 4; if (attacker.role === "Glass Cannon") damage += 6; if (defender.role === "Tank") damage = Math.max(4, damage - 5); const healChance = battleStat === "Luck" ? 0.36 : 0.28; const heal = attacker.role === "Healer" && cryptoRandomFloat() < healChance ? Math.max(6, Math.round(a.Luck * 0.8)) : 0; return { damage, crit, dodge: false, heal }; }
function maxHpFor(card) { return getCardStats(card).HP; }
function getRole(card) { if (card?.role && ROLES.includes(card.role)) return card.role; const text = `${card?.name || ""} ${card?.category || ""} ${card?.description || ""}`.toLowerCase(); if (/tank|giant|big|mega|king|queen|wall|boss|chunk|rock/.test(text)) return "Tank"; if (/angry|fight|strong|warrior|ninja|pirate|monster|dragon|dino/.test(text)) return "Brawler"; if (/laser|fire|wizard|blast|electric|storm|spooky|ghost|demon/.test(text)) return "Glass Cannon"; if (/silly|chaos|clown|goofy|sneak|shadow|random|trick/.test(text)) return "Trickster"; if (/doctor|nurse|angel|heart|healer|snack|food|cookie|cake/.test(text)) return "Healer"; return ROLES[hashString(card?.id || card?.name || "goober") % ROLES.length]; }
function getCardStats(card) { const role = getRole(card); const t = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.Balanced; return { HP: pickInRange(card, "hp", t.hp), Attack: pickInRange(card, "atk", t.attack), Defense: pickInRange(card, "def", t.defense), Speed: pickInRange(card, "spd", t.speed), Luck: pickInRange(card, "luck", t.luck) }; }
function pickInRange(card, salt, range) { const [min, max] = range; return min + (hashString(`${card?.id || card?.name || "goober"}-${salt}`) % (max - min + 1)); }
function shuffle(items) { for (let i = items.length - 1; i > 0; i--) { const j = cryptoRandomInt(0, i); [items[i], items[j]] = [items[j], items[i]]; } }
function cryptoRandomInt(min, max) { const range = max - min + 1; const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return min + (bytes[0] % range); }
function cryptoRandomFloat() { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] / 4294967295; }
function hashString(text) { let h = 2166136261; for (let i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h >>> 0); }

async function listGoobers(env) { const result = await env.DB.prepare(`SELECT id, name, category, description, image_key, image_type, created_at FROM goobers WHERE approved = 1 ORDER BY created_at DESC`).all(); const goobers = (result.results || []).map((row) => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}`, createdAt: row.created_at })); return jsonResponse(goobers, 200, NO_STORE_HEADERS); }
async function uploadGoober(request, env) { const formData = await request.formData(); const uploadCode = cleanText(formData.get("uploadCode"), 120); const name = cleanText(formData.get("name"), 80); const category = cleanText(formData.get("category"), 30); const description = cleanText(formData.get("description"), 280); const image = formData.get("image"); if (!hasValidUploadCode(uploadCode, env)) return jsonResponse({ error: "Invalid upload code." }, 403, NO_STORE_HEADERS); if (!name) return jsonResponse({ error: "Goober name is required." }, 400, NO_STORE_HEADERS); if (!description) return jsonResponse({ error: "Goober description is required." }, 400, NO_STORE_HEADERS); if (!ALLOWED_CATEGORIES.has(category)) return jsonResponse({ error: "Invalid category." }, 400, NO_STORE_HEADERS); if (!(image instanceof File)) return jsonResponse({ error: "Image file is required." }, 400, NO_STORE_HEADERS); if (!image.type.startsWith("image/")) return jsonResponse({ error: "File must be an image." }, 400, NO_STORE_HEADERS); if (image.size > MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large. Max size is 5 MB." }, 400, NO_STORE_HEADERS); const id = crypto.randomUUID(); const extension = getExtension(image.name, image.type); const imageKey = `goobers/${id}.${extension}`; await env.GOOBER_IMAGES.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { originalName: image.name || "goober-upload", gooberName: name } }); await env.DB.prepare(`INSERT INTO goobers (id, name, category, description, image_key, image_type, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`).bind(id, name, category, description, imageKey, image.type).run(); return jsonResponse({ id, name, category, description, imageUrl: `/api/goober-image/${imageKey}` }, 201, NO_STORE_HEADERS); }
async function deleteGoober(request, env) { const url = new URL(request.url); const id = decodeURIComponent(url.pathname.replace("/api/goobers/", "")).trim(); if (!id || id.includes("/") || id.includes("..")) return jsonResponse({ error: "Invalid goober id." }, 400, NO_STORE_HEADERS); const adminCode = await readAdminCode(request); if (!hasValidAdminCode(adminCode, env)) return jsonResponse({ error: "Invalid admin delete code." }, 403, NO_STORE_HEADERS); const row = await env.DB.prepare(`SELECT id, image_key FROM goobers WHERE id = ?`).bind(id).first(); if (!row) return jsonResponse({ error: "Goober not found." }, 404, NO_STORE_HEADERS); await env.DB.prepare(`UPDATE goobers SET approved = 0 WHERE id = ?`).bind(id).run(); try { if (row.image_key) await env.GOOBER_IMAGES.delete(row.image_key); } catch (error) { console.error("R2 image delete failed after DB soft delete", error); } return jsonResponse({ ok: true, id, deleted: true }, 200, NO_STORE_HEADERS); }
async function readAdminCode(request) { const headerCode = cleanText(request.headers.get("x-goober-admin-code"), 120); if (headerCode) return headerCode; const contentType = request.headers.get("content-type") || ""; if (contentType.includes("application/json")) { const body = await request.json().catch(() => ({})); return cleanText(body.adminCode, 120); } if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) { const formData = await request.formData().catch(() => null); return cleanText(formData?.get("adminCode"), 120); } return ""; }
function hasValidUploadCode(code, env) { const expected = cleanText(env.GOOBER_UPLOAD_CODE, 120); return Boolean(expected && code && safeEqual(code, expected)); }
function hasValidAdminCode(code, env) { const expected = cleanText(env.GOOBER_ADMIN_CODE || env.GOOBER_UPLOAD_CODE, 120); return Boolean(expected && code && safeEqual(code, expected)); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
async function getGooberImage(request, env) { const url = new URL(request.url); const imageKey = decodeURIComponent(url.pathname.replace("/api/goober-image/", "")); if (!imageKey || imageKey.includes("..") || !imageKey.startsWith("goobers/")) return jsonResponse({ error: "Invalid image key." }, 400, NO_STORE_HEADERS); const object = await env.GOOBER_IMAGES.get(imageKey); if (!object) return jsonResponse({ error: "Image not found" }, 404, NO_STORE_HEADERS); const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=31536000, immutable"); return new Response(object.body, { headers }); }
function cleanText(value, maxLength) { if (typeof value !== "string") return ""; return value.trim().replace(/\s+/g, " ").slice(0, maxLength); }
function getExtension(filename = "", contentType = "") { const lower = filename.toLowerCase(); if (lower.endsWith(".png")) return "png"; if (lower.endsWith(".webp")) return "webp"; if (lower.endsWith(".gif")) return "gif"; if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg"; if (contentType.includes("png")) return "png"; if (contentType.includes("webp")) return "webp"; if (contentType.includes("gif")) return "gif"; return "jpg"; }
function jsonResponse(data, status = 200, headers = {}) { return corsResponse(JSON.stringify(data), status, { "content-type": "application/json; charset=utf-8", ...headers }); }
function corsResponse(body, status = 200, headers = {}) { return new Response(body, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, x-goober-admin-code, cache-control, pragma", ...headers } }); }
