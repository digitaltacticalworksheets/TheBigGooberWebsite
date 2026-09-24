// Online match client: talks to the CardBattleRoom durable object over a WebSocket.
import { Battle } from "./battle.js";
import { toast } from "./ui.js";

function tokenFor(code) {
  const key = `gooberCardsSeat.${code}`;
  try {
    let token = localStorage.getItem(key);
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(key, token);
    }
    return token;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export async function createRoom() {
  const res = await fetch("/api/card-battle/create", { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't create a room. Try again in a moment.");
  return res.json();
}

// Quick match: wait in the global queue until someone else is searching too.
// handlers: { onQueue(searching), onMatched(roomCode), onError(message) }. Returns { cancel }.
export function findMatch(handlers, auth = "") {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ token: tokenFor("matchmaking") });
  if (auth) params.set("auth", auth);
  const ws = new WebSocket(`${proto}//${location.host}/api/card-battle/matchmaking?${params}`);
  let done = false;
  const finish = () => { done = true; clearInterval(ping); try { ws.close(); } catch { /* already closed */ } };
  const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
  ws.addEventListener("message", event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === "queue") handlers.onQueue?.(msg.searching);
    else if (msg.type === "matched") { finish(); handlers.onMatched?.(msg.roomCode, Boolean(msg.ranked)); }
    else if (msg.type === "error") { finish(); handlers.onError?.(msg.message); }
  });
  ws.addEventListener("close", () => { if (!done) { finish(); handlers.onError?.("Lost connection to matchmaking."); } });
  return { cancel: finish };
}

// Matchmade games happening right now, for the Watch Live list.
export async function liveGames() {
  const res = await fetch("/api/card-battle/live", { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load live matches.");
  return res.json();
}

export class OnlineMatch {
  // opts: { code, name, heroId, deck (entries), catalog, heroArtFor(id), onLobby(room, seat), onEnd(result), onExit, showRules, toggleSound, soundOn,
  //         watch (join as a spectator), onWatchEnd(room, game) }
  constructor(opts) {
    this.opts = opts;
    this.code = opts.code;
    this.catalog = opts.catalog;
    this.token = tokenFor(opts.code);
    this.seat = null;
    this.room = null;
    this.battle = null;
    this.closed = false;
    this.retries = 0;
    this.deckSent = false;
    this.endSignaled = false;
    this.waitingRematch = false;
    this.spectating = Boolean(opts.watch);
    this.connect();
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ token: this.token, name: this.opts.name || "Goober Fan", hero: this.opts.heroId || "" });
    if (this.opts.auth) params.set("auth", this.opts.auth);
    if (this.opts.watch) params.set("watch", "1");
    const ws = new WebSocket(`${proto}//${location.host}/api/card-battle/${this.code}/socket?${params}`);
    this.ws = ws;
    ws.addEventListener("open", () => { this.retries = 0; });
    ws.addEventListener("message", event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this.onMessage(msg);
    });
    ws.addEventListener("close", () => {
      if (this.closed) return;
      this.retries += 1;
      if (this.retries > 8) { toast("Lost connection to the room.", "bad"); this.opts.onLobby?.(this.room, this.seat, "disconnected"); return; }
      if (this.retries === 1) toast("Reconnecting…");
      setTimeout(() => !this.closed && this.connect(), Math.min(8000, 600 * 2 ** this.retries));
    });
    clearInterval(this.ping);
    this.ping = setInterval(() => this.send({ type: "ping" }), 25000);
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(payload)); return true; }
    return false;
  }

  onMessage(msg) {
    if (msg.type === "catalog") { Object.assign(this.catalog, msg.cards || {}); return; }
    if (msg.type === "error") { toast(msg.message, "bad"); this.pendingResolve?.({ ok: true }); this.pendingResolve = null; return; }
    if (msg.type === "emote") { this.battle?.showEmote(msg.seat, msg.key); return; }
    if (msg.type === "reward") { this.lastReward = msg; return; }
    if (msg.type !== "state") return;

    this.seat = msg.seat;
    const prevPhase = this.room?.phase;
    this.room = msg.room;
    if (this.seat < 0) {
      // Both seats taken: watch instead of bouncing.
      if (!this.spectating) { this.spectating = true; toast("This room is full, so you're watching.", "good"); }
      return this.onSpectatorState(msg, prevPhase);
    }
    const mine = this.room.seats[this.seat];
    if (this.room.phase !== "playing" && mine && !mine.ready && !this.deckSent) {
      this.deckSent = true;
      this.send({ type: "deck", deck: this.opts.deck });
    }

    if (this.room.phase === "playing") { this.waitingRematch = false; if (!msg.game?.over) this.endSignaled = false; }
    if (this.waitingRematch) { this.opts.onLobby?.(this.room, this.seat, "rematch"); return; }
    if (msg.game) {
      if (!this.battle || this.battle.destroyed) this.startBattle(msg.game);
      const events = msg.events || [];
      this.battle.update(msg.game, events, { deadline: this.room.phase === "playing" ? this.room.deadline : 0, watchers: this.room.watchers || 0 });
      this.pendingResolve?.({ ok: true });
      this.pendingResolve = null;
      if (msg.game.over && !this.endSignaled) {
        this.endSignaled = true;
        const won = msg.game.winner === this.seat;
        setTimeout(() => this.opts.onEnd?.({ won, draw: msg.game.winner === "draw" }), 1100);
      }
    }
    if (!msg.game || this.room.phase === "lobby") this.opts.onLobby?.(this.room, this.seat, "lobby");
    else if (this.room.phase === "over") this.opts.onLobby?.(this.room, this.seat, "over");
  }

  onSpectatorState(msg, prevPhase) {
    if (!msg.game || this.room.phase === "lobby") {
      if (this.battle) { this.battle.destroy(); this.battle = null; }
      this.opts.onLobby?.(this.room, -1, "watching");
      return;
    }
    // A rematch started: begin a fresh board.
    if (this.battle && prevPhase && prevPhase !== "playing" && this.room.phase === "playing") { this.battle.destroy(); this.battle = null; }
    // Joining a game that already ended shouldn't announce a winner.
    if (!this.battle || this.battle.destroyed) { this.startBattle(); this.endSignaled = Boolean(msg.game.over); }
    this.battle.update(msg.game, msg.events || [], { deadline: this.room.phase === "playing" ? this.room.deadline : 0, watchers: this.room.watchers || 0 });
    if (!msg.game.over) this.endSignaled = false;
    else if (!this.endSignaled) {
      this.endSignaled = true;
      setTimeout(() => this.opts.onWatchEnd?.(this.room, msg.game), 1100);
    }
  }

  startBattle() {
    if (this.spectating) {
      this.battle = new Battle({
        catalog: this.catalog,
        me: 0,
        spectator: true,
        heroArt: [this.opts.heroArtFor(this.room.seats[0]?.hero), this.opts.heroArtFor(this.room.seats[1]?.hero)],
        onAction: async () => ({ ok: false, error: "You're watching." }),
        onExit: () => this.opts.onExit?.(),
        showRules: this.opts.showRules,
        toggleSound: this.opts.toggleSound,
        soundOn: this.opts.soundOn
      });
      return;
    }
    const oppSeat = this.seat === 0 ? 1 : 0;
    const heroArt = [this.opts.heroArtFor(this.room.seats[this.seat]?.hero), this.opts.heroArtFor(this.room.seats[oppSeat]?.hero)];
    this.battle = new Battle({
      catalog: this.catalog,
      me: this.seat,
      heroArt,
      onAction: action => this.act(action),
      onEmote: key => this.send({ type: "emote", key }),
      onConcede: () => this.send({ type: "action", action: { type: "concede" } }),
      onExit: () => this.opts.onExit?.(),
      showRules: this.opts.showRules,
      toggleSound: this.opts.toggleSound,
      soundOn: this.opts.soundOn
    });
  }

  // Resolves once the server answers (with a new state or an error).
  act(action) {
    return new Promise(resolve => {
      if (!this.send({ type: "action", action })) { resolve({ ok: false, error: "Not connected. Reconnecting…" }); return; }
      this.pendingResolve = resolve;
      setTimeout(() => { if (this.pendingResolve === resolve) { this.pendingResolve = null; resolve({ ok: true }); } }, 6000);
    });
  }

  rematch(deck) {
    this.lastReward = null;
    this.deckSent = true;
    this.waitingRematch = true;
    this.battle?.destroy();
    this.battle = null;
    this.send({ type: "rematch", deck });
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    try { this.ws?.close(); } catch { /* already closed */ }
    this.battle?.destroy();
    this.battle = null;
  }
}
