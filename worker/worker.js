export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return corsResponse(null, 204);
      if (url.pathname === "/api/goobers" && request.method === "GET") return await listGoobers(env);
      if (url.pathname === "/api/goobers" && request.method === "POST") return await uploadGoober(request, env);
      if (url.pathname === "/api/card-battle/create" && request.method === "POST") return await createCardBattleRoom(env);
      if (url.pathname.startsWith("/api/card-battle/") && request.method === "GET") return await routeCardBattleRoom(request, env);
      if (url.pathname.startsWith("/api/goobers/") && request.method === "DELETE") return await deleteGoober(request, env);
      if (url.pathname.startsWith("/api/goober-image/") && request.method === "GET") return await getGooberImage(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: error.message || "Server error" }, 500);
    }
  }
};

export class CardBattleRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sessions = new Map(); this.room = this.createEmptyRoom(); }
  createEmptyRoom() { return { roomCode: "", players: {}, scores: { p1: 0, p2: 0 }, round: 0, selectedStat: null, lastResult: "Waiting for players to join the Goober Cards room.", lastWinner: null, lastDamage: 0, lastEvent: null, knockout: false, battleActive: false, battleLog: [], teamBattle: true, matchWinner: null, rewardSummary: null, status: "waiting" }; }
  async fetch(request) {
    const url = new URL(request.url), roomCode = getRoomCodeFromPath(url.pathname);
    if (!roomCode) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS);
    await this.loadRoom(roomCode);
    if (request.headers.get("upgrade") !== "websocket") return jsonResponse(this.getPublicState("spectator").room, 200, NO_STORE_HEADERS);
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    const requestedPlayer = url.searchParams.get("playerId") || url.searchParams.get("player");
    const playerId = this.assignPlayerId(requestedPlayer);
    const playerName = cleanText(url.searchParams.get("name"), 40) || `Player ${playerId === "p1" ? "1" : playerId === "p2" ? "2" : "Spectator"}`;
    server.accept(); this.sessions.set(server, { playerId });
    this.room.players[playerId] = normalizePlayer({ ...(this.room.players[playerId] || {}), id: playerId, name: playerName, connected: true });
    this.updateStatus(); await this.ensureTeams(); await this.saveRoom();
    server.addEventListener("message", async event => {
      await this.handleMessage(server, event.data).catch(error => {
        console.error(error);
        this.send(server, { type: "error", message: error.message || "Room error." });
      });
    });
    server.addEventListener("close", async () => {
      const session = this.sessions.get(server); this.sessions.delete(server);
      if (session?.playerId && this.room.players[session.playerId]) {
        this.room.players[session.playerId].connected = false;
        this.updateStatus(); await this.saveRoom(); this.broadcastState();
      }
    });
    this.send(server, { type: "joined", roomCode, playerId }); this.broadcastState();
    return new Response(null, { status: 101, webSocket: client });
  }
  async loadRoom(roomCode) {
    const stored = await this.state.storage.get("room");
    if (stored) {
      this.room = { ...this.createEmptyRoom(), ...stored, players: stored.players || {}, scores: stored.scores || { p1: 0, p2: 0 }, battleLog: Array.isArray(stored.battleLog) ? stored.battleLog : [] };
      this.room.roomCode = this.room.roomCode || roomCode; this.room.teamBattle = true;
      for (const id of ["p1", "p2"]) if (this.room.players[id]) this.room.players[id] = normalizePlayer(this.room.players[id]);
      return;
    }
    this.room = this.createEmptyRoom(); this.room.roomCode = roomCode; await this.saveRoom();
  }
  async saveRoom() { await this.state.storage.put("room", this.room); }
  assignPlayerId(requested) { if ((requested === "p1" || requested === "p2") && !this.room.players[requested]?.connected) return requested; if (!this.room.players.p1) return "p1"; if (!this.room.players.p2) return "p2"; if (!this.room.players.p2.connected) return "p2"; if (!this.room.players.p1.connected) return "p1"; return `spectator-${crypto.randomUUID().slice(0, 6)}`; }
  updateStatus() { this.room.status = Boolean(this.room.players.p1) && Boolean(this.room.players.p2) ? "ready" : "waiting"; }
  pushLog(entry) { this.room.battleLog = [entry, ...(Array.isArray(this.room.battleLog) ? this.room.battleLog : [])].slice(0, 80); }
  async ensureTeams(force = false) {
    if (!this.room.players.p1 || !this.room.players.p2) return;
    const p1Needs = force || !Array.isArray(this.room.players.p1.hand) || this.room.players.p1.hand.length < 3;
    const p2Needs = force || !Array.isArray(this.room.players.p2.hand) || this.room.players.p2.hand.length < 3;
    if (!p1Needs && !p2Needs) return;
    const deck = await this.getDeck(), dealt = dealHands(deck, 3);
    for (const id of ["p1", "p2"]) {
      const player = this.room.players[id], hand = id === "p1" ? dealt.p1 : dealt.p2;
      if ((id === "p1" && p1Needs) || (id === "p2" && p2Needs)) {
        player.hand = hand.map(addCardHealth); player.team = player.hand.map(addCardHealth); player.activeIndex = 0; player.card = addCardHealth(player.team[0]);
      }
      if (force) { player.card = addCardHealth(player.team[0]); player.activeIndex = 0; }
      player.ready = false; player.action = null; player.momentum = force ? 0 : Number(player.momentum || 0);
    }
    if (force) { this.room.selectedStat = null; this.room.lastWinner = null; this.room.lastDamage = 0; this.room.lastEvent = "deal"; this.room.knockout = false; this.room.battleActive = false; this.room.matchWinner = null; this.room.rewardSummary = null; this.room.battleLog = []; this.room.lastResult = "Fresh 3-card teams dealt. Pick a lead Goober, then both players press Ready."; }
  }
  async getDeck() { try { const result = await this.env.DB.prepare(`SELECT id, name, category, description, image_key FROM goobers WHERE approved = 1`).all(); const deck = (result.results || []).map(row => addCardHealth({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}` })); shuffle(deck); if (deck.length) return deck; } catch (error) { console.error("Could not load Goober deck", error); } return [addCardHealth({ id: "fallback-original-goober", name: "Original Goober", category: "classic", description: "The original loaf-sitting Goober.", imageUrl: "/assets/original-goober.jpg" })]; }
  async handleMessage(socket, data) {
    let message; try { message = JSON.parse(data); } catch { throw new Error("Invalid room message."); }
    const session = this.sessions.get(socket); if (!session) throw new Error("Session not found."); const player = this.room.players[session.playerId];
    if (message.type === "setName") { const name = cleanText(message.name, 40); if (name && player) player.name = name; }
    if (message.type === "playCard") {
      if (!player || session.playerId.startsWith("spectator")) throw new Error("Only Player 1 and Player 2 can switch cards.");
      if (this.room.knockout) throw new Error("Deal new teams before switching cards.");
      await this.ensureTeams(); syncActive(player);
      const idx = (player.team || player.hand || []).findIndex(candidate => candidate.id === cleanText(message.cardId, 120));
      if (idx < 0) throw new Error("That card is not in your team.");
      const chosen = addCardHealth(player.team[idx]);
      if (chosen.hp <= 0) throw new Error("That Goober is knocked out.");
      player.activeIndex = idx; player.card = chosen; syncActive(player);
      if (!this.room.battleActive) player.ready = false;
      this.room.lastEvent = "switch"; this.room.selectedStat = null; this.room.lastDamage = 0; this.room.lastWinner = null;
      this.room.lastResult = this.room.battleActive ? `${player.name} switched to ${player.card.name}. Choose actions for the next turn.` : `${player.name} chose a lead card. Waiting for both players to press Ready.`;
      this.pushLog({ round: this.room.round, title: "Goober switch", text: `${player.name} switched active Goober to ${player.card.name}.`, p1Hp: hpText(this.room.players.p1), p2Hp: hpText(this.room.players.p2) });
    }
    if (message.type === "ready") {
      if (!player || session.playerId.startsWith("spectator")) throw new Error("Only players can ready up.");
      if (!player.card) throw new Error("Choose a lead card before pressing Ready.");
      if (this.room.knockout) throw new Error("Deal new teams before readying up.");
      player.ready = true; this.room.lastEvent = "ready";
      if (this.room.players.p1?.ready && this.room.players.p2?.ready && this.room.players.p1?.card && this.room.players.p2?.card) {
        this.room.battleActive = true;
        this.room.players.p1.action = null; this.room.players.p2.action = null;
        this.room.lastResult = `Cards revealed: ${this.room.players.p1.card.name} vs ${this.room.players.p2.card.name}. Each player chooses an action before Player 1 resolves the turn.`;
        this.pushLog({ round: 0, title: "Cards revealed", text: `Player 1 leads with ${this.room.players.p1.card.name}. Player 2 leads with ${this.room.players.p2.card.name}. Choose actions: Attack, Defend, Charge, Trick, or Swap.`, stat: "Reveal", p1Hp: hpText(this.room.players.p1), p2Hp: hpText(this.room.players.p2) });
      } else this.room.lastResult = `${player.name} is ready. Waiting for the other player.`;
    }
    if (message.type === "chooseAction") this.chooseAction(session.playerId, message.action);
    if (message.type === "roll") { if (session.playerId !== "p1") throw new Error("Player 1 resolves the turn."); this.rollBattle(); }
    if (message.type === "ultimate") { if (!player || session.playerId.startsWith("spectator")) throw new Error("Only players can use ultimates."); if (!this.room.battleActive || this.room.knockout) throw new Error("Ultimates can only be charged during an active battle."); this.chargeUltimate(session.playerId); }
    if (message.type === "newRound") { if (!this.room.knockout && this.room.battleActive) throw new Error("Team battle is still running."); await this.ensureTeams(true); }
    if (message.type === "resetScore") { this.room.scores = { p1: 0, p2: 0 }; this.room.round = 0; await this.ensureTeams(true); this.room.lastEvent = "reset"; this.room.lastResult = "Score reset. Fresh 3-card teams were dealt."; }
    this.updateStatus(); await this.saveRoom(); this.broadcastState();
  }
  chooseAction(playerId, action) {
    const player = this.room.players[playerId];
    if (!player || playerId.startsWith("spectator")) throw new Error("Only players can choose actions.");
    if (!this.room.battleActive || this.room.knockout) throw new Error("Actions are only available during battle.");
    const allowed = new Set(["attack", "defend", "charge", "trick", "swap"]);
    const picked = allowed.has(action) ? action : "attack";
    player.action = picked;
    if (picked === "charge") player.momentum = Math.min(9, Number(player.momentum || 0) + 1);
    this.room.lastEvent = "action";
    const p1A = this.room.players.p1?.action, p2A = this.room.players.p2?.action;
    this.room.lastResult = p1A && p2A ? `Actions locked: Player 1 chose ${labelAction(p1A)}. Player 2 chose ${labelAction(p2A)}. Player 1 can resolve the turn.` : `${player.name} chose an action. Waiting for the other player.`;
  }
  chargeUltimate(playerId) {
    const player = this.room.players[playerId];
    if (!player?.card) throw new Error("You need an active card to charge an ultimate.");
    player.card = addCardHealth(player.card); syncActive(player);
    if (player.card.ultimateUsed) throw new Error("That Goober already used its ultimate.");
    if (player.card.ultimatePending) throw new Error("That Goober's ultimate is already charged.");
    if (Number(player.momentum || 0) < 3) throw new Error("You need 3 momentum to charge an ultimate.");
    player.momentum = Number(player.momentum || 0) - 3;
    player.card.ultimatePending = true; syncActive(player);
    this.room.selectedStat = null; this.room.lastWinner = null; this.room.lastDamage = 0; this.room.lastEvent = "ultimateReady";
    this.room.lastResult = `${player.name} spent 3 momentum to charge ${player.card.name}'s ${player.card.specialMove}. It triggers on that Goober's next successful attack.`;
    this.pushLog({ round: this.room.round, title: "Ultimate charged", text: `${player.name} charged ${player.card.name}'s ${player.card.specialMove}.`, stat: "Ultimate", damage: 0, special: player.card.specialMove, p1Hp: hpText(this.room.players.p1), p2Hp: hpText(this.room.players.p2) });
  }
  rollBattle() {
    const p1 = this.room.players.p1, p2 = this.room.players.p2;
    if (this.room.knockout) throw new Error("The team battle is over. Deal new teams for the next match.");
    if (!p1?.card || !p2?.card) throw new Error("Both players need an active card.");
    if (!p1.ready || !p2.ready || !this.room.battleActive) throw new Error("Both players must press Ready before battle starts.");
    if (!p1.action || !p2.action) throw new Error("Both players must choose an action before resolving the turn.");
    p1.card = addCardHealth(p1.card); p2.card = addCardHealth(p2.card); syncActive(p1); syncActive(p2);
    const p1Mods = actionMods(p1.action), p2Mods = actionMods(p2.action);
    const battleStat = BATTLE_STATS[cryptoRandomInt(0, BATTLE_STATS.length - 1)], matchup = getBattleMatchup(p1.card, p2.card, battleStat, p1Mods, p2Mods);
    const attackerId = matchup.winnerId, defenderId = attackerId === "p1" ? "p2" : "p1";
    const attacker = this.room.players[attackerId], defender = this.room.players[defenderId];
    const attackerMods = attackerId === "p1" ? p1Mods : p2Mods, defenderMods = defenderId === "p1" ? p1Mods : p2Mods;
    const attackerAction = attacker.action, defenderAction = defender.action;
    const defenderStartingHp = defender.card.hp;
    const result = calculateAttack(attacker.card, defender.card, battleStat, matchup.margin, attackerMods, defenderMods);
    this.room.selectedStat = battleStat; this.room.round += 1; this.room.lastDamage = result.damage;
    const scoreLine = `${p1.card.name}: ${matchup.p1Score} (${labelAction(p1.action)}) | ${p2.card.name}: ${matchup.p2Score} (${labelAction(p2.action)})`;
    if (result.dodge) {
      attacker.momentum = Math.min(9, Number(attacker.momentum || 0) + 1);
      defender.momentum = Math.min(9, Number(defender.momentum || 0) + 1);
      this.room.lastWinner = "tie"; this.room.lastDamage = 0; this.room.lastEvent = "dodge";
      const text = `Turn ${this.room.round}: ${battleStat}. ${scoreLine}. ${attacker.card.name} won the stat roll, but ${defender.card.name} dodged. Both sides gain momentum.`;
      this.finishTurn(text, { round: this.room.round, title: `${battleStat} roll: dodge`, text, stat: battleStat, damage: 0, p1Hp: hpText(p1), p2Hp: hpText(p2) });
      return;
    }
    let ultimate = null;
    if (attacker.card.ultimatePending) {
      ultimate = rollUltimateAbility(attacker.card, defender.card);
      result.damage += ultimate.damage || 0; result.heal += ultimate.heal || 0; result.recoil += ultimate.recoil || 0;
      attacker.card.ultimatePending = false; attacker.card.ultimateUsed = true;
    }
    defender.card.hp = Math.max(0, defender.card.hp - result.damage);
    if (result.recoil) attacker.card.hp = Math.max(1, attacker.card.hp - result.recoil);
    if (result.heal) attacker.card.hp = Math.min(attacker.card.maxHp, attacker.card.hp + result.heal);
    attacker.momentum = Math.min(9, Number(attacker.momentum || 0) + 1 + (result.special.triggered ? 1 : 0) + (ultimate ? 1 : 0));
    syncActive(attacker); syncActive(defender);
    this.room.lastWinner = attackerId; this.room.lastEvent = ultimate ? "special" : result.special.triggered ? "special" : result.crit ? "crit" : result.heal ? "heal" : "hit";
    const extras = [];
    if (result.crit) extras.push("Critical hit");
    if (ultimate) extras.push(`ULTIMATE: ${attacker.card.specialMove}. ${ultimate.text}`);
    if (result.special.triggered) extras.push(`Special: ${attacker.card.specialMove}. ${result.special.text}`);
    if (attackerAction === "charge") extras.push(`${attacker.name}'s Charge added power and momentum`);
    if (defenderAction === "defend") extras.push(`${defender.name}'s Defend reduced the hit`);
    if (defenderAction === "swap") extras.push(`${defender.name}'s Swap softened the hit`);
    if (result.recoil) extras.push(`${attacker.card.name} took ${result.recoil} recoil HP`);
    let text = `Turn ${this.room.round}: ${battleStat}. ${scoreLine}. ${attacker.card.name} attacked ${defender.card.name} for ${result.damage} HP. ${defender.card.name}: ${defenderStartingHp} → ${defender.card.hp} HP.`;
    if (extras.length) text += ` ${extras.join(". ")}.`;
    if (defender.card.hp <= 0) {
      attacker.momentum = Math.min(9, Number(attacker.momentum || 0) + 3);
      text += ` ${defender.card.name} is knocked out!`;
      const nextIndex = nextAliveIndex(defender.team, defender.activeIndex + 1);
      if (nextIndex >= 0) { defender.activeIndex = nextIndex; defender.card = addCardHealth(defender.team[nextIndex]); text += ` ${defender.name}'s next Goober enters: ${defender.card.name}. Choose actions for the next turn.`; this.room.lastEvent = "knockout"; }
      else { this.room.knockout = true; this.room.battleActive = false; p1.ready = false; p2.ready = false; this.room.matchWinner = attackerId; this.room.scores[attackerId] += 1; this.room.lastEvent = "knockout"; this.room.rewardSummary = buildRewardSummary(attackerId, this.room); text += ` ${defender.name} has no Goobers left. ${attacker.name} wins the team battle!`; }
    } else text += " Choose actions for the next turn.";
    this.room.lastDamage = result.damage; this.room.lastResult = text;
    this.finishTurn(text, { round: this.room.round, title: `${battleStat} turn: ${attacker.card.name} hits`, text, stat: battleStat, p1Score: matchup.p1Score, p2Score: matchup.p2Score, attacker: attacker.card.name, defender: defender.card.name, damage: result.damage, special: ultimate ? `${attacker.card.specialMove} Ultimate` : result.special.triggered ? attacker.card.specialMove : "", p1Hp: hpText(p1), p2Hp: hpText(p2) });
  }
  finishTurn(text, logEntry) { this.room.lastResult = text; this.pushLog(logEntry); if (!this.room.knockout) { if (this.room.players.p1) this.room.players.p1.action = null; if (this.room.players.p2) this.room.players.p2.action = null; } }
  getPublicState(viewerId = "spectator") { return { type: "state", room: this.getRoomView(viewerId) }; }
  getRoomView(viewerId = "spectator") {
    const reveal = Boolean(this.room.battleActive || this.room.knockout || (this.room.players.p1?.ready && this.room.players.p2?.ready));
    const players = {};
    for (const id of ["p1", "p2"]) {
      const player = this.room.players[id]; if (!player) continue;
      const isViewer = viewerId === id;
      const safeHand = isViewer || reveal ? (player.hand || player.team || []) : (player.hand || player.team || []).map((_, i) => hiddenCard(`${id}-hand-${i}`, "Hidden Card"));
      players[id] = { ...player, action: isViewer || (this.room.players.p1?.action && this.room.players.p2?.action) ? player.action : player.action ? "locked" : null, hand: safeHand, team: safeHand, card: player.card && (reveal || isViewer) ? player.card : player.card ? hiddenCard(`${id}-chosen`, "Chosen Card") : null };
    }
    return { roomCode: this.room.roomCode, players, scores: this.room.scores, round: this.room.round, selectedStat: this.room.selectedStat, lastResult: this.room.lastResult, lastWinner: this.room.lastWinner, lastDamage: this.room.lastDamage, lastEvent: this.room.lastEvent, knockout: this.room.knockout, battleActive: this.room.battleActive, battleLog: this.room.battleLog || [], teamBattle: true, matchWinner: this.room.matchWinner, rewardSummary: this.room.rewardSummary, status: this.room.status };
  }
  broadcastState() { for (const [socket, session] of this.sessions.entries()) this.send(socket, this.getPublicState(session?.playerId || "spectator")); }
  send(socket, payload) { try { socket.send(JSON.stringify(payload)); } catch (error) { console.error("WebSocket send failed", error); } }
}

const ALLOWED_CATEGORIES = new Set(["classic", "costume", "chaos", "funny", "spooky", "animal", "food", "sports", "holiday", "fancy", "superhero", "random"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024, BATTLE_STATS = ["Attack", "Defense", "Speed", "Luck"], ROLES = ["Tank", "Brawler", "Glass Cannon", "Trickster", "Healer", "Balanced"];
const ROLE_TEMPLATES = { Tank: { hp: [132, 156], attack: [18, 27], defense: [23, 32], speed: [4, 7], luck: [4, 9], move: "Loaf Wall" }, Brawler: { hp: [106, 126], attack: [30, 40], defense: [14, 21], speed: [6, 10], luck: [5, 10], move: "Heavy Bonk" }, "Glass Cannon": { hp: [72, 92], attack: [41, 54], defense: [6, 12], speed: [10, 15], luck: [8, 14], move: "Chaos Blast" }, Trickster: { hp: [88, 108], attack: [24, 34], defense: [8, 15], speed: [13, 18], luck: [12, 20], move: "Silly Dodge" }, Healer: { hp: [96, 118], attack: [17, 27], defense: [13, 21], speed: [6, 10], luck: [10, 16], move: "Snack Break" }, Balanced: { hp: [98, 120], attack: [25, 35], defense: [13, 20], speed: [8, 12], luck: [7, 13], move: "Reliable Goob" } };
const NO_STORE_HEADERS = { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "pragma": "no-cache", "expires": "0", "surrogate-control": "no-store", "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" };
function normalizePlayer(player) { const hand = normalizeHand(player.hand || player.team || []); const team = normalizeHand(player.team || hand); const activeIndex = Math.max(0, Math.min(Number(player.activeIndex) || 0, Math.max(0, team.length - 1))); const card = player.card ? addCardHealth(player.card) : team[activeIndex] ? addCardHealth(team[activeIndex]) : null; return { ...player, ready: Boolean(player.ready), action: player.action || null, momentum: Number(player.momentum || 0), hand, team: team.length ? team : hand, activeIndex, card }; }
function syncActive(player) { if (!player?.team?.length || !player.card) return; player.team[player.activeIndex] = addCardHealth(player.card); player.hand = player.team.map(addCardHealth); }
function hpText(player) { return player?.card ? `${player.card.hp}/${player.card.maxHp}` : "0/0"; }
function labelAction(action) { return ({ attack: "Attack", defend: "Defend", charge: "Charge", trick: "Trick", swap: "Swap", locked: "Locked" })[action] || "Attack"; }
function actionMods(action) { const base = { score: 0, damage: 1, defense: 1, dodge: 0, special: 0 }; if (action === "attack") return { ...base, damage: 1.1 }; if (action === "defend") return { ...base, defense: 0.65, dodge: 5 }; if (action === "charge") return { ...base, score: -2, damage: 1.25, special: 15 }; if (action === "trick") return { ...base, score: 2, damage: 0.85, dodge: 15, special: 5 }; if (action === "swap") return { ...base, damage: 0.75, defense: 0.75, dodge: 7 }; return base; }
function nextAliveIndex(team, start = 0) { for (let i = start; i < team.length; i++) if (Number(team[i]?.hp) > 0) return i; for (let i = 0; i < team.length; i++) if (Number(team[i]?.hp) > 0) return i; return -1; }
function buildRewardSummary(winnerId, room) { const winner = room.players[winnerId], loser = room.players[winnerId === "p1" ? "p2" : "p1"]; return { title: `${winner?.name || winnerId} wins the team battle!`, text: `${winner?.name || winnerId} knocked out all 3 of ${loser?.name || "the opponent"}'s Goobers. Biggest bonk: ${room.lastDamage || 0} HP.`, winnerId, winnerName: winner?.name || winnerId, titleEarned: room.lastDamage >= 30 ? "Big Bonker" : "Goober Champion" }; }
async function createCardBattleRoom(env) { const roomCode = createRoomCode(); return jsonResponse({ roomCode, url: `/goober-cards/?room=${roomCode}&player=p1`, inviteUrl: `/goober-cards/?room=${roomCode}&player=p2` }, 201, NO_STORE_HEADERS); }
async function routeCardBattleRoom(request, env) { if (!env.CARD_BATTLE_ROOMS) return jsonResponse({ error: "Card battle rooms are not configured." }, 500, NO_STORE_HEADERS); const roomCode = getRoomCodeFromPath(new URL(request.url).pathname); if (!roomCode) return jsonResponse({ error: "Room code is required." }, 400, NO_STORE_HEADERS); const id = env.CARD_BATTLE_ROOMS.idFromName(roomCode); return env.CARD_BATTLE_ROOMS.get(id).fetch(request); }
function createRoomCode() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = ""; const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); for (const byte of bytes) code += alphabet[byte % alphabet.length]; return code; }
function getRoomCodeFromPath(pathname) { const match = pathname.match(/^\/api\/card-battle\/([A-Z0-9]{4,12})(?:\/socket)?$/i); return match ? match[1].toUpperCase() : ""; }
function dealHands(deck, handSize = 3) { const pool = [...deck].map(card => addCardHealth(card)); shuffle(pool); while (pool.length < handSize * 2) pool.push(...deck.map(card => addCardHealth(card))); return { p1: pool.slice(0, handSize), p2: pool.slice(handSize, handSize * 2) }; }
function normalizeHand(hand) { return Array.isArray(hand) ? hand.map(card => addCardHealth(card)) : []; }
function hiddenCard(id, name = "Hidden Card") { return addCardHealth({ id: `hidden-${id}`, name, category: "hidden", description: "This card is hidden until both players are ready.", imageUrl: "/assets/original-goober.jpg", role: "Balanced", specialMove: "Secret Move" }); }
function addCardHealth(card) { const safeCard = card || { id: "fallback-original-goober", name: "Original Goober", category: "classic", description: "The original loaf-sitting Goober.", imageUrl: "/assets/original-goober.jpg" }; const maxHp = Number(safeCard.maxHp) || maxHpFor(safeCard); const hp = Number.isFinite(Number(safeCard.hp)) ? Math.max(0, Math.min(maxHp, Number(safeCard.hp))) : maxHp; const role = getRole(safeCard); return { ...safeCard, hp, maxHp, role, ultimateUsed: Boolean(safeCard.ultimateUsed), ultimatePending: Boolean(safeCard.ultimatePending), specialMove: safeCard.specialMove || ROLE_TEMPLATES[role]?.move || "Goober Move" }; }
function getBattleMatchup(p1Card, p2Card, battleStat, p1Mods = actionMods("attack"), p2Mods = actionMods("attack")) { const p1Stats = getCardStats(p1Card), p2Stats = getCardStats(p2Card); const p1Score = Math.round(p1Stats[battleStat] + (p1Mods.score || 0) + cryptoRandomFloat() * Math.max(2, p1Stats.Luck * 0.45)); const p2Score = Math.round(p2Stats[battleStat] + (p2Mods.score || 0) + cryptoRandomFloat() * Math.max(2, p2Stats.Luck * 0.45)); let winnerId = p1Score >= p2Score ? "p1" : "p2"; if (p1Score === p2Score) winnerId = p1Stats.Speed >= p2Stats.Speed ? "p1" : "p2"; return { winnerId, p1Score, p2Score, margin: Math.abs(p1Score - p2Score) }; }
function calculateAttack(attacker, defender, battleStat = "Attack", margin = 0, attackerMods = actionMods("attack"), defenderMods = actionMods("attack")) { const a = getCardStats(attacker), d = getCardStats(defender); const roll = cryptoRandomFloat() * 100; let dodgeChance = Math.min(45, d.Speed * 0.75 + d.Luck * 0.55 + (defenderMods.dodge || 0)), critChance = Math.min(32, a.Luck * 1.2); if (battleStat === "Speed") dodgeChance += 4; if (battleStat === "Luck") critChance += 7; if (roll < dodgeChance) return { damage: 0, crit: false, dodge: true, heal: 0, recoil: 0, special: { triggered: false, text: "" } }; const crit = roll > 100 - critChance; const statBonus = Math.round(margin * (battleStat === "Attack" ? 1.15 : battleStat === "Defense" ? 0.7 : battleStat === "Speed" ? 0.8 : 0.9)); let damage = Math.max(5, Math.round((a.Attack * 1.35 - d.Defense * 0.68 + 6 + statBonus) * (crit ? 1.75 : 1) * (attackerMods.damage || 1) * (defenderMods.defense || 1))); if (battleStat === "Defense") damage = Math.max(5, damage + Math.round(a.Defense * 0.25)); if (attacker.role === "Brawler") damage += 4; if (attacker.role === "Glass Cannon") damage += 6; if (defender.role === "Tank") damage = Math.max(4, damage - 5); let heal = attacker.role === "Healer" && cryptoRandomFloat() < (battleStat === "Luck" ? 0.36 : 0.28) ? Math.max(6, Math.round(a.Luck * 0.8)) : 0; let recoil = 0; const special = rollSpecialAbility(attacker, defender, battleStat, margin, attackerMods.special || 0); if (special.triggered) { damage += special.bonusDamage || 0; heal += special.heal || 0; recoil += special.recoil || 0; } return { damage, crit, dodge: false, heal, recoil, special }; }
function rollUltimateAbility(attacker, defender) { const a = getCardStats(attacker), role = attacker.role || getRole(attacker); if (role === "Tank") { const heal = Math.max(10, Math.round(a.Defense * 0.55)), damage = Math.max(8, Math.round(a.Defense * 0.45 + a.Attack * 0.4)); return { damage, heal, recoil: 0, text: `Loaf Wall Ultimate restored ${heal} HP.` }; } if (role === "Brawler") { const damage = Math.max(18, Math.round(a.Attack * 1.25)); return { damage, heal: 0, recoil: 0, text: "Heavy Bonk Ultimate landed a massive smash." }; } if (role === "Glass Cannon") { const damage = Math.max(24, Math.round(a.Attack * 1.55)), recoil = Math.max(5, Math.round(damage * 0.18)); return { damage, heal: 0, recoil, text: "Chaos Blast Ultimate hit extremely hard." }; } if (role === "Trickster") { const damage = Math.max(14, Math.round((a.Speed + a.Luck) * 0.85)); return { damage, heal: 0, recoil: 0, text: "Silly Dodge Ultimate turned speed into damage." }; } if (role === "Healer") { const heal = Math.max(16, Math.round(a.Luck * 1.4 + a.Defense * 0.35)), damage = Math.max(8, Math.round(a.Luck * 0.7)); return { damage, heal, recoil: 0, text: `Snack Break Ultimate restored ${heal} HP.` }; } const damage = Math.max(12, Math.round((a.Attack + a.Speed) * 0.55)), heal = Math.max(6, Math.round(a.Luck * 0.6)); return { damage, heal, recoil: 0, text: `Reliable Goob Ultimate added damage and restored ${heal} HP.` }; }
function rollSpecialAbility(attacker, defender, battleStat, margin, extraChance = 0) { const a = getCardStats(attacker); const chance = Math.min(55, 18 + a.Luck * 0.9 + (battleStat === "Luck" ? 8 : 0) + extraChance); if (cryptoRandomFloat() * 100 >= chance) return { triggered: false, text: "", bonusDamage: 0, heal: 0, recoil: 0 }; const role = attacker.role || getRole(attacker); if (role === "Tank") { const heal = Math.max(5, Math.round(a.Defense * 0.3)), bonusDamage = Math.max(3, Math.round(a.Defense * 0.2)); return { triggered: true, bonusDamage, heal, recoil: 0, text: `Loaf Wall added ${bonusDamage} shield damage and restored ${heal} HP.` }; } if (role === "Brawler") { const bonusDamage = Math.max(8, Math.round(a.Attack * 0.45 + margin * 0.5)); return { triggered: true, bonusDamage, heal: 0, recoil: 0, text: `Heavy Bonk smashed for ${bonusDamage} extra HP.` }; } if (role === "Glass Cannon") { const bonusDamage = Math.max(12, Math.round(a.Attack * 0.65)), recoil = Math.max(4, Math.round(bonusDamage * 0.28)); return { triggered: true, bonusDamage, heal: 0, recoil, text: `Chaos Blast exploded for ${bonusDamage} extra HP, but caused ${recoil} recoil HP.` }; } if (role === "Trickster") { const bonusDamage = Math.max(6, Math.round((a.Speed + a.Luck) * 0.35)); return { triggered: true, bonusDamage, heal: 0, recoil: 0, text: `Silly Dodge countered for ${bonusDamage} extra HP.` }; } if (role === "Healer") { const heal = Math.max(10, Math.round(a.Luck * 1.15 + a.Defense * 0.2)); return { triggered: true, bonusDamage: 0, heal, recoil: 0, text: `Snack Break restored ${heal} HP.` }; } const bonusDamage = Math.max(5, Math.round((a.Attack + a.Speed) * 0.18)), heal = Math.max(3, Math.round(a.Luck * 0.35)); return { triggered: true, bonusDamage, heal, recoil: 0, text: `Reliable Goob added ${bonusDamage} damage and restored ${heal} HP.` }; }
function maxHpFor(card) { return getCardStats(card).HP; }
function getRole(card) { if (card?.role && ROLES.includes(card.role)) return card.role; const text = `${card?.name || ""} ${card?.category || ""} ${card?.description || ""}`.toLowerCase(); if (/tank|giant|big|mega|king|queen|wall|boss|chunk|rock/.test(text)) return "Tank"; if (/angry|fight|strong|warrior|ninja|pirate|monster|dragon|dino/.test(text)) return "Brawler"; if (/laser|fire|wizard|blast|electric|storm|spooky|ghost|demon/.test(text)) return "Glass Cannon"; if (/silly|chaos|clown|goofy|sneak|shadow|random|trick/.test(text)) return "Trickster"; if (/doctor|nurse|angel|heart|healer|snack|food|cookie|cake/.test(text)) return "Healer"; return ROLES[hashString(card?.id || card?.name || "goober") % ROLES.length]; }
function getCardStats(card) { const role = getRole(card), t = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.Balanced; return { HP: pickInRange(card, "hp", t.hp), Attack: pickInRange(card, "atk", t.attack), Defense: pickInRange(card, "def", t.defense), Speed: pickInRange(card, "spd", t.speed), Luck: pickInRange(card, "luck", t.luck) }; }
function pickInRange(card, salt, range) { const [min, max] = range; return min + (hashString(`${card?.id || card?.name || "goober"}-${salt}`) % (max - min + 1)); }
function shuffle(items) { for (let i = items.length - 1; i > 0; i--) { const j = cryptoRandomInt(0, i); [items[i], items[j]] = [items[j], items[i]]; } }
function cryptoRandomInt(min, max) { const range = max - min + 1, bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return min + (bytes[0] % range); }
function cryptoRandomFloat() { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] / 4294967295; }
function hashString(text) { let h = 2166136261; for (let i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h >>> 0); }
async function listGoobers(env) { const result = await env.DB.prepare(`SELECT id, name, category, description, image_key, image_type, created_at FROM goobers WHERE approved = 1 ORDER BY created_at DESC`).all(); return jsonResponse((result.results || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, imageUrl: `/api/goober-image/${row.image_key}`, createdAt: row.created_at })), 200, NO_STORE_HEADERS); }
async function uploadGoober(request, env) { const formData = await request.formData(); const uploadCode = cleanText(formData.get("uploadCode"), 120), name = cleanText(formData.get("name"), 80), category = cleanText(formData.get("category"), 30), description = cleanText(formData.get("description"), 280), image = formData.get("image"); if (!hasValidUploadCode(uploadCode, env)) return jsonResponse({ error: "Invalid upload code." }, 403, NO_STORE_HEADERS); if (!name) return jsonResponse({ error: "Goober name is required." }, 400, NO_STORE_HEADERS); if (!description) return jsonResponse({ error: "Goober description is required." }, 400, NO_STORE_HEADERS); if (!ALLOWED_CATEGORIES.has(category)) return jsonResponse({ error: "Invalid category." }, 400, NO_STORE_HEADERS); if (!(image instanceof File)) return jsonResponse({ error: "Image file is required." }, 400, NO_STORE_HEADERS); if (!image.type.startsWith("image/")) return jsonResponse({ error: "File must be an image." }, 400, NO_STORE_HEADERS); if (image.size > MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large. Max size is 5 MB." }, 400, NO_STORE_HEADERS); const id = crypto.randomUUID(), extension = getExtension(image.name, image.type), imageKey = `goobers/${id}.${extension}`; await env.GOOBER_IMAGES.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { originalName: image.name || "goober-upload", gooberName: name } }); await env.DB.prepare(`INSERT INTO goobers (id, name, category, description, image_key, image_type, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`).bind(id, name, category, description, imageKey, image.type).run(); return jsonResponse({ id, name, category, description, imageUrl: `/api/goober-image/${imageKey}` }, 201, NO_STORE_HEADERS); }
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
