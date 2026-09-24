// Battle screen: renders a game state, handles touch input, and animates engine events.
import { playInfo, attackTargets, canAttack, powerTargets, legalActions, applyAction, BOARD_LIMIT, MAX_MANA } from "./engine.js";
import { chooseAiAction } from "./ai.js";
import { HERO_POWER, KEYWORDS, CATEGORY_STYLE } from "./cards.js";
import { $, esc, sleep, cardHTML, cardBackHTML, artHTML, modal, confirmDialog, keywordGlossary, onLongPress, toast } from "./ui.js";
import { sfx, buzz } from "./sound.js";

export const EMOTES = { hello: "Sup 👋", wow: "W 🔥", oops: "L 😭", thanks: "💀💀💀", woof: "Skill issue 🤡", gg: "GG 🤝" };

const TRIGGER_ICON = { battlecry: "", lastBark: "☠️", endTurn: "⏳" };

export class Battle {
  // opts: { catalog, me, heroArt: [mine, theirs], onAction(action) -> Promise<{ok, error}>, onEmote(key), onExit(), onConcede(), menuExtra }
  constructor(opts) {
    this.opts = opts;
    this.catalog = opts.catalog;
    this.me = opts.me;
    this.state = null;
    this.sel = null;
    this.drag = null;
    this.queue = Promise.resolve();
    this.animating = false;
    this.pending = false;
    this.deadline = 0;
    this.destroyed = false;
    this.mount();
  }

  get opp() { return this.me === 0 ? 1 : 0; }
  get myTurn() { return Boolean(this.state && !this.state.over && this.state.active === this.me); }
  get canInput() { return this.myTurn && !this.animating && !this.pending; }

  mount() {
    document.body.classList.add("in-battle");
    const root = document.createElement("div");
    root.className = "battle";
    root.innerHTML = `
      <div class="table"></div>
      <div class="hero-bar opp opp-bar">
        <div class="hero opp" data-uid="h${this.opp}" style="background-image:url('${esc(this.opts.heroArt?.[1] || "/assets/spider-goober.jpg")}')"><div class="hp"></div><div class="armor" hidden></div></div>
        <div class="hero-info"><div class="nm"></div><div class="mana"></div></div>
        <div class="spacer"></div>
        <div class="opp-hand"></div>
        <div class="deck-count" title="Cards left in deck"></div>
        <button class="menu-btn" data-menu aria-label="Menu">☰</button>
      </div>
      <div class="board opp-board"></div>
      <div class="midline"><span class="turn-label"></span><div class="history" aria-label="Recently played cards"></div><button class="end-turn" data-end>End Turn</button><div class="timer" hidden><i></i></div></div>
      <div class="board my-board"></div>
      <div class="hero-bar my-bar">
        <div class="hero me" data-uid="h${this.me}" style="background-image:url('${esc(this.opts.heroArt?.[0] || "/assets/original-goober.jpg")}')"><div class="hp"></div><div class="armor" hidden></div></div>
        <div class="hero-info"><div class="nm"></div><div class="mana"></div></div>
        <div class="spacer"></div>
        <button class="power" data-power aria-label="Hero power: ${esc(HERO_POWER.name)}"><span class="pc">${HERO_POWER.cost}</span>💨</button>
        <div class="deck-count" title="Cards left in deck"></div>
      </div>
      <div class="hand"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.el = {
      oppHero: $(".hero.opp", root), myHero: $(".hero.me", root),
      oppBar: $(".opp-bar", root), myBar: $(".my-bar", root),
      oppBoard: $(".opp-board", root), myBoard: $(".my-board", root),
      hand: $(".hand", root), oppHand: $(".opp-hand", root),
      end: $("[data-end]", root), power: $("[data-power]", root),
      turnLabel: $(".turn-label", root), timer: $(".timer", root), history: $(".history", root)
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("arrow-layer");
    svg.innerHTML = `<path></path><circle r="9" hidden></circle>`;
    document.body.appendChild(svg);
    this.arrow = svg;
    this.tip = document.createElement("div");
    this.tip.className = "card-tip";
    this.tip.hidden = true;
    this.tip.addEventListener("click", e => {
      if (!e.target.closest("[data-details]") || this.sel?.kind !== "hand") return;
      const el = this.el.hand.querySelector(`[data-uid="${this.sel.uid}"]`);
      if (el) this.inspect(el);
    });
    document.body.appendChild(this.tip);

    this.el.end.addEventListener("click", () => this.endTurn());
    this.el.power.addEventListener("click", () => this.selectPower());
    $("[data-menu]", root).addEventListener("click", () => this.openMenu());
    root.addEventListener("pointerdown", e => this.onDown(e));
    this.onMoveBound = e => this.onMove(e);
    this.onUpBound = e => this.onUp(e);
    window.addEventListener("pointermove", this.onMoveBound, { passive: false });
    window.addEventListener("pointerup", this.onUpBound);
    window.addEventListener("pointercancel", this.onUpBound);
    this.longPressFired = onLongPress(root, ".hcard, .minion, .hero", el => this.inspect(el));
    this.resizeBound = () => this.layoutHand();
    window.addEventListener("resize", this.resizeBound);
    this.timerInterval = setInterval(() => this.renderTimer(), 1000);
  }

  destroy() {
    this.destroyed = true;
    document.body.classList.remove("in-battle");
    window.removeEventListener("pointermove", this.onMoveBound);
    window.removeEventListener("pointerup", this.onUpBound);
    window.removeEventListener("pointercancel", this.onUpBound);
    window.removeEventListener("resize", this.resizeBound);
    clearInterval(this.timerInterval);
    this.root.remove();
    this.arrow.remove();
    this.tip.remove();
    this.mulliganEl?.remove();
    document.querySelectorAll(".reveal, .banner, .float-num, .bubble, .emote-menu").forEach(el => el.remove());
  }

  // Queue a new state (+ events to animate). Returns when it's on screen.
  update(state, events = [], extra = {}) {
    this.queue = this.queue.then(async () => {
      if (this.destroyed) return;
      if (extra.deadline !== undefined) this.deadline = extra.deadline;
      const first = !this.state;
      this.animating = true;
      try {
        if (!first) await this.playEvents(events);
      } catch (error) { console.error(error); }
      this.state = state;
      this.sel = null;
      this.render(new Set(events.filter(e => e.t === "summon").map(e => e.uid)), new Set(events.filter(e => e.t === "draw" && e.player === this.me).map(e => e.uid)));
      await this.postEvents(events, first);
      this.animating = false;
      this.render();
      this.maybeMulligan();
    });
    return this.queue;
  }

  // ---------------------------------------------------------------- rendering
  def(id) { return this.catalog[id]; }

  render(summoned = new Set(), drawn = new Set()) {
    const s = this.state;
    if (!s || this.destroyed) return;
    const me = s.players[this.me], opp = s.players[this.opp];
    this.renderHero(this.el.oppHero, opp.hero);
    this.renderHero(this.el.myHero, me.hero);
    $(".nm", this.el.oppBar).textContent = opp.name;
    $(".nm", this.el.myBar).textContent = me.name;
    $(".mana", this.el.oppBar).innerHTML = `✨ ${opp.mana}/${opp.maxMana} Aura`;
    $(".mana", this.el.myBar).innerHTML = `✨ ${me.mana}/${me.maxMana} <span class="pips">${Array.from({ length: Math.max(me.maxMana, 1) }, (_, i) => `<i class="${i < me.mana ? "full" : ""}"></i>`).join("")}</span>`;
    $(".deck-count", this.el.oppBar).textContent = `🂠${opp.deckCount ?? opp.deck.length}`;
    $(".deck-count", this.el.myBar).textContent = `🂠${me.deckCount ?? me.deck.length}`;
    const oppHandCount = opp.handCount ?? opp.hand.length;
    this.el.oppHand.innerHTML = Array.from({ length: Math.min(oppHandCount, 10) }, () => cardBackHTML()).join("");
    this.el.oppHand.title = `${oppHandCount} cards in hand`;

    const targets = new Set(this.currentTargets());
    this.renderBoard(this.el.oppBoard, opp.board, false, targets, summoned);
    this.renderBoard(this.el.myBoard, me.board, true, targets, summoned);
    for (const hero of [this.el.oppHero, this.el.myHero]) {
      const uid = hero.dataset.uid;
      hero.classList.toggle("targetable", targets.has(uid) && uid === `h${this.opp}`);
      hero.classList.toggle("friendly-target", targets.has(uid) && uid === `h${this.me}`);
    }
    this.renderHand(drawn);
    this.renderHistory();

    // Hero power + end turn.
    const pTargets = powerTargets(s, this.me);
    this.el.power.classList.toggle("used", me.powerUsed);
    this.el.power.classList.toggle("ready", this.canInput && pTargets.length > 0 && !this.sel);
    this.el.power.disabled = !this.canInput || !pTargets.length;
    if (s.over) { this.el.end.disabled = true; this.el.end.textContent = "Game Over"; }
    else if (this.myTurn) {
      this.el.end.disabled = this.animating || this.pending;
      this.el.end.textContent = "End Turn";
      const moves = legalActions(s, this.catalog, this.me).filter(a => a.type !== "end" && !(a.type === "power"));
      this.el.end.classList.toggle("done", !moves.length);
    } else { this.el.end.disabled = true; this.el.end.textContent = "Their Turn…"; this.el.end.classList.remove("done"); }
    this.el.turnLabel.textContent = s.over ? "" : `Turn ${Math.ceil(s.turn / 2)}`;
    this.el.myBoard.classList.toggle("drop-ok", Boolean(this.sel?.kind === "hand" && this.sel.isMinion && !this.sel.placed));
    this.renderTip();
    this.renderTimer();
  }

  renderHero(el, hero) {
    const hp = $(".hp", el);
    hp.textContent = hero.hp;
    hp.classList.toggle("low", hero.hp <= 6);
    const armor = $(".armor", el);
    armor.hidden = !hero.armor;
    armor.textContent = hero.armor;
  }

  renderBoard(container, minions, mine, targets, summoned) {
    const before = new Map([...container.children].filter(el => el.dataset.uid).map(el => [el.dataset.uid, el.getBoundingClientRect()]));
    const existing = new Map([...container.children].filter(el => el.dataset.uid).map(el => [el.dataset.uid, el]));
    const nodes = minions.map(m => {
      const def = this.def(m.id) || { name: "?", category: "random", art: { emoji: "❓" } };
      let el = existing.get(m.uid);
      if (!el) {
        el = document.createElement("div");
        el.dataset.uid = m.uid;
        el.innerHTML = `<div class="body">${artHTML(def)}</div><div class="atk"></div><div class="hp"></div><div class="icons"></div>`;
        el.style.setProperty("--cat", (CATEGORY_STYLE[def.category] || CATEGORY_STYLE.random).color);
      }
      const kws = m.keywords || [];
      const cls = ["minion", def.rarity, m.shiny ? "shiny" : "", ...kws.filter(k => ["guard", "fluffy", "sneaky"].includes(k)), m.frozen ? "frozen" : ""];
      if (mine && canAttack(this.state, this.me, m.uid) && this.canInput) cls.push("can-attack");
      if (mine && m.sick && !m.frozen && this.myTurn) cls.push("sick");
      if (this.sel?.uid === m.uid) cls.push("selected");
      if (targets.has(m.uid)) cls.push(mine ? "friendly-target" : "targetable");
      if (summoned.has(m.uid)) cls.push("summoned");
      el.className = cls.filter(Boolean).join(" ");
      const atk = $(".atk", el), hp = $(".hp", el);
      atk.textContent = m.attack;
      atk.classList.toggle("buffed", m.attack > (def.attack ?? m.attack));
      hp.textContent = m.health;
      hp.classList.toggle("hurt", m.health < m.maxHealth);
      hp.classList.toggle("buffed", m.health >= m.maxHealth && m.maxHealth > (def.health ?? m.maxHealth));
      const icons = kws.filter(k => ["bitey", "lifesnack", "doubleWag"].includes(k)).map(k => KEYWORDS[k].icon);
      if (def.ability && TRIGGER_ICON[def.ability.trigger]) icons.push(TRIGGER_ICON[def.ability.trigger]);
      $(".icons", el).textContent = icons.join("");
      return el;
    });
    if (!nodes.length) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = mine ? (this.myTurn ? "Drop Goobers here" : "") : "";
      container.replaceChildren(hint);
      return;
    }
    container.replaceChildren(...nodes);
    // FLIP: slide surviving minions into their new spots.
    for (const el of nodes) {
      const prev = before.get(el.dataset.uid);
      if (!prev) continue;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      if (Math.abs(dx) > 2) el.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], { duration: 250, easing: "ease-out" });
    }
  }

  renderHand(drawn = new Set()) {
    const s = this.state, me = s.players[this.me];
    const existing = new Map([...this.el.hand.children].map(el => [el.dataset.uid, el]));
    const nodes = me.hand.map(inst => {
      let el = existing.get(inst.uid);
      if (!el) {
        el = document.createElement("div");
        el.dataset.uid = inst.uid;
        el.innerHTML = cardHTML(this.def(inst.id), { shiny: inst.shiny });
        if (drawn.has(inst.uid)) { el.classList.add("drawn"); setTimeout(() => el.classList.remove("drawn"), 500); }
      }
      const info = this.canInput ? playInfo(s, this.catalog, this.me, inst.uid) : { playable: false };
      const pricey = (this.def(inst.id)?.cost ?? 0) > me.mana;
      el.className = ["hcard", info.playable ? "playable" : "", pricey ? "pricey" : "", this.sel?.kind === "hand" && this.sel.uid === inst.uid ? "selected" : "", el.classList.contains("drawn") ? "drawn" : ""].filter(Boolean).join(" ");
      return el;
    });
    this.el.hand.replaceChildren(...nodes);
    this.layoutHand();
  }

  layoutHand() {
    if (!this.state) return;
    const cards = [...this.el.hand.children];
    const n = cards.length;
    if (!n) return;
    const width = this.el.hand.clientWidth;
    const cw = cards[0].offsetWidth || 100;
    const spacing = n > 1 ? Math.min(cw * 0.9, (width - cw - 20) / (n - 1)) : 0;
    cards.forEach((el, i) => {
      if (el.classList.contains("dragging")) return;
      const offset = i - (n - 1) / 2;
      const x = offset * spacing;
      const rot = offset * Math.min(5, 28 / n);
      const y = Math.abs(offset) * Math.abs(offset) * 1.6;
      el.style.zIndex = String(10 + i);
      if (el.classList.contains("selected") && this.currentTargets().length) {
        // Picking a target: tuck the card back down so the glowing targets are visible.
        el.classList.add("aiming");
        el.style.transform = `translateX(calc(-50% + ${x}px)) translateY(-18%) scale(0.92)`;
      } else if (el.classList.contains("selected")) {
        el.classList.remove("aiming");
        // Blow the card up so its text is easy to read, keeping it on screen.
        const scale = Math.max(1.25, Math.min(1.9, (window.innerWidth * 0.5) / cw, (window.innerHeight * 0.42) / (cw * 1.4)));
        const half = (cw * scale) / 2;
        const clampedX = Math.max(-width / 2 + half + 6, Math.min(width / 2 - half - 6, x));
        el.style.transform = `translateX(calc(-50% + ${clampedX}px)) translateY(-72%) scale(${scale})`;
      } else {
        el.style.transform = `translateX(calc(-50% + ${x}px)) translateY(${y}px) rotate(${rot}deg)`;
      }
    });
  }

  renderHistory() {
    const items = (this.state.history || []).slice(-6);
    this.el.history.innerHTML = items.map((h, i) => {
      const def = this.def(h.id);
      if (!def) return "";
      const art = def.art?.image ? `<img src="${esc(def.art.image)}" alt="" draggable="false">` : `<span>${esc(def.art?.emoji || "❓")}</span>`;
      return `<button class="hist ${h.player === this.me ? "mine" : "theirs"} ${def.rarity}" data-hist="${i}" title="${esc(def.name)}">${art}<em>${def.cost}</em></button>`;
    }).join("");
  }

  inspectHistory(i) {
    const h = (this.state.history || []).slice(-6)[i];
    const def = h && this.def(h.id);
    if (!def) return;
    sfx.tap();
    const who = h.player === this.me ? "You played" : `${esc(this.state.players[h.player].name)} played`;
    modal(`<div class="inspect">${cardHTML(def, { shiny: h.shiny })}<div class="details"><p><b>${who} this.</b></p>${def.flavor ? `<p><i>${esc(def.flavor)}</i></p>` : ""}${keywordGlossary(def.keywords, def)}</div><button class="btn primary" data-close>Close</button></div>`, { bare: true });
  }

  renderTip() {
    let text = "";
    let details = false;
    if (this.sel?.kind === "hand") {
      details = true;
      const def = this.def(this.state.players[this.me].hand.find(c => c.uid === this.sel.uid)?.id);
      if (this.sel.preview) text = `${this.sel.reason || "Can't play this yet"}`;
      else if (this.sel.isMinion && !this.sel.placed) text = this.sel.targets ? `Tap the table to place ${def?.name}, then pick a target` : `Tap the table to play ${def?.name}`;
      else if (this.sel.targets) text = `Pick a glowing target for ${def?.name}`;
      else text = `Tap the table to use ${def?.name}`;
    } else if (this.sel?.kind === "attack") text = "Tap a glowing enemy to attack";
    else if (this.sel?.kind === "power") text = `${HERO_POWER.name} 💨: tap an enemy`;
    this.tip.hidden = !text;
    const mid = this.root.querySelector(".midline")?.getBoundingClientRect();
    if (mid) this.tip.style.top = `${mid.top + mid.height / 2}px`;
    this.tip.innerHTML = `<span>${esc(text)}</span>${details ? `<button type="button" data-details>ⓘ Details</button>` : ""}`;
  }

  renderTimer() {
    if (!this.deadline || !this.state || this.state.over) { this.el.timer.hidden = true; return; }
    const left = Math.max(0, this.deadline - Date.now());
    this.el.timer.hidden = false;
    $("i", this.el.timer).style.width = `${Math.min(100, (left / 90000) * 100)}%`;
    this.el.timer.classList.toggle("hurry", left < 15000);
  }

  // Swap cards out of your opening hand, once, before your first move.
  maybeMulligan() {
    const s = this.state, me = s?.players[this.me];
    if (!me || s.over || s.active !== this.me || me.mulliganDone || this.mulliganEl) return;
    const picks = new Set();
    const el = document.createElement("div");
    el.className = "mulligan";
    const cards = me.hand.filter(c => c.id !== "token-crumb");
    el.innerHTML = `<div class="mulligan-box">
      <h2>Starting hand</h2>
      <p>Tap up to 4 cards to swap them for new ones.</p>
      <div class="mulligan-cards">${cards.map(c => `<button class="mull-card" data-mull="${esc(c.uid)}">${cardHTML(this.def(c.id), { shiny: c.shiny })}<span class="swap-x">SWAP</span></button>`).join("")}</div>
      <div class="actions"><button class="btn primary big" data-keep>Keep hand</button></div>
    </div>`;
    const keep = el.querySelector("[data-keep]");
    el.addEventListener("click", async e => {
      const card = e.target.closest("[data-mull]");
      if (card) {
        const uid = card.dataset.mull;
        if (picks.has(uid)) picks.delete(uid);
        else if (picks.size < 4) picks.add(uid);
        card.classList.toggle("picked", picks.has(uid));
        keep.textContent = picks.size ? `Swap ${picks.size} card${picks.size === 1 ? "" : "s"}` : "Keep hand";
        sfx.tap();
        return;
      }
      if (e.target.closest("[data-keep]")) {
        el.remove();
        this.mulliganEl = null;
        await this.send({ type: "mulligan", uids: [...picks] });
      }
    });
    document.body.appendChild(el);
    this.mulliganEl = el;
  }

  // ---------------------------------------------------------------- selection
  currentTargets() {
    if (!this.sel) return [];
    if (this.sel.kind === "hand") return this.sel.preview || (this.sel.isMinion && !this.sel.placed) ? [] : this.sel.targets || [];
    return this.sel.targets || [];
  }

  selectHand(uid) {
    const info = playInfo(this.state, this.catalog, this.me, uid);
    if (!info.playable) {
      // Still show the card big so its text can be read.
      const need = (info.def || this.def(this.state.players[this.me].hand.find(c => c.uid === uid)?.id))?.cost - this.state.players[this.me].mana;
      const reason = info.reason === "Not enough Aura." && need > 0 ? `Need ${need} more Aura` : info.reason;
      sfx.select();
      this.sel = { kind: "hand", uid, preview: true, reason };
      this.render();
      return;
    }
    sfx.select();
    this.sel = { kind: "hand", uid, isMinion: info.def.type === "minion", targets: info.targets, placed: false, position: null };
    this.render();
  }

  selectAttacker(uid) {
    const targets = attackTargets(this.state, this.me, uid);
    if (!targets.length) return;
    sfx.tap();
    this.sel = { kind: "attack", uid, targets };
    this.render();
  }

  selectPower() {
    if (!this.canInput) return;
    if (this.sel?.kind === "power") { this.clearSel(); return; }
    const targets = powerTargets(this.state, this.me);
    if (!targets.length) { toast(this.state.players[this.me].powerUsed ? "BARK FART is once per turn. Pace yourself." : "Not enough Aura.", "bad"); return; }
    sfx.tap();
    this.sel = { kind: "power", targets };
    this.render();
  }

  clearSel() {
    if (!this.sel) return;
    this.sel = null;
    this.render();
  }

  async commit(target = null) {
    const sel = this.sel;
    if (!sel) return;
    let action;
    if (sel.preview) return;
    if (sel.kind === "hand") action = { type: "play", uid: sel.uid, ...(target ? { target } : {}), ...(sel.position !== null && sel.position !== undefined ? { position: sel.position } : {}) };
    else if (sel.kind === "attack") action = { type: "attack", uid: sel.uid, target };
    else if (sel.kind === "power") action = { type: "power", target };
    this.sel = null;
    await this.send(action);
  }

  async send(action) {
    if (this.pending) return;
    this.pending = true;
    this.render();
    try {
      const res = await this.opts.onAction(action);
      if (res && !res.ok) { toast(res.error || "Can't do that.", "bad"); sfx.error(); }
    } finally {
      this.pending = false;
      this.render();
    }
  }

  async endTurn() {
    if (!this.canInput) return;
    const moves = legalActions(this.state, this.catalog, this.me).filter(a => a.type === "play" || a.type === "attack");
    if (moves.some(a => a.type === "attack") && !this.skipEndConfirm) {
      const ok = await confirmDialog("End your turn?", "Some of your Goobers can still attack.", { yes: "End Turn", no: "Keep playing" });
      if (!ok) return;
    }
    this.sel = null;
    sfx.endTurn();
    await this.send({ type: "end" });
  }

  // ---------------------------------------------------------------- input
  boardPosition(clientX) {
    const els = [...this.el.myBoard.querySelectorAll(".minion")];
    let pos = 0;
    for (const el of els) { const r = el.getBoundingClientRect(); if (clientX > r.left + r.width / 2) pos++; }
    return pos;
  }

  onDown(e) {
    if (e.button > 0) return;
    this.closeEmoteMenu(e);
    const hcard = e.target.closest(".hcard");
    const myMinion = e.target.closest(".my-board .minion");
    this.drag = { x: e.clientX, y: e.clientY, target: e.target, moved: false, kind: null, uid: null, pointerId: e.pointerId };
    if (!this.canInput) return;
    if (hcard) { this.drag.kind = "hand"; this.drag.uid = hcard.dataset.uid; this.drag.el = hcard; }
    else if (myMinion && canAttack(this.state, this.me, myMinion.dataset.uid)) { this.drag.kind = "minion"; this.drag.uid = myMinion.dataset.uid; this.drag.el = myMinion; }
  }

  onMove(e) {
    const d = this.drag;
    if (!d || !d.kind || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
    e.preventDefault();
    if (!d.moved) {
      d.moved = true;
      if (d.kind === "hand") {
        const info = playInfo(this.state, this.catalog, this.me, d.uid);
        if (!info.playable) { toast(info.reason || "Can't play that yet.", "bad"); sfx.error(); d.kind = null; return; }
        this.sel = { kind: "hand", uid: d.uid, isMinion: info.def.type === "minion", targets: info.targets, placed: false, position: null };
        d.arrow = !this.sel.isMinion && Boolean(info.targets);
      } else {
        this.sel = { kind: "attack", uid: d.uid, targets: attackTargets(this.state, this.me, d.uid) };
        d.arrow = true;
      }
      this.render();
      if (d.kind === "hand" && !d.arrow) {
        d.el.classList.add("dragging");
        d.el.style.position = "fixed";
        d.el.style.bottom = "auto";
      }
    }
    if (d.arrow) this.drawArrow(d.el, e.clientX, e.clientY);
    else if (d.kind === "hand") {
      d.el.style.left = `${e.clientX - d.el.offsetWidth / 2}px`;
      d.el.style.top = `${e.clientY - d.el.offsetHeight / 2}px`;
      d.el.style.transform = "scale(0.9)";
      const handTop = this.el.hand.getBoundingClientRect().top;
      this.el.myBoard.classList.toggle("drop-ok", e.clientY < handTop - 10);
    }
  }

  async onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.pointerId !== e.pointerId) return;
    this.hideArrow();
    if (d.el) {
      d.el.classList.remove("dragging");
      for (const prop of ["position", "bottom", "left", "top"]) d.el.style[prop] = "";
    }
    if (this.longPressFired()) return;
    if (!d.moved) { this.handleTap(d.target, e.clientX); return; }
    if (!d.kind || !this.sel) { this.render(); return; }
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const uid = under?.closest("[data-uid]")?.dataset.uid;
    const handTop = this.el.hand.getBoundingClientRect().top;
    if (this.sel.kind === "attack" || d.arrow) {
      if (uid && this.sel.targets?.includes(uid)) await this.commit(uid);
      else this.clearSel();
      return;
    }
    // Dragging a card that doesn't need an arrow.
    if (e.clientY >= handTop - 10) { this.clearSel(); return; }
    if (this.sel.isMinion) {
      this.sel.position = this.boardPosition(e.clientX);
      if (this.sel.targets) { this.sel.placed = true; sfx.tap(); this.render(); return; }
    }
    await this.commit(null);
  }

  handleTap(t, clientX) {
    const hist = t.closest("[data-hist]");
    if (hist) { this.inspectHistory(Number(hist.dataset.hist)); return; }
    if (!this.canInput) {
      // Reading cards is always allowed, even on their turn.
      const peek = t.closest(".hcard, .minion");
      if (peek && !this.animating) this.inspect(peek);
      return;
    }
    const uid = t.closest("[data-uid]")?.dataset.uid;
    const sel = this.sel;
    if (sel && uid && this.currentTargets().includes(uid)) { this.commit(uid); return; }
    const hcard = t.closest(".hcard");
    if (hcard) {
      if (sel?.kind === "hand" && sel.uid === hcard.dataset.uid) {
        if (sel.preview || sel.targets) this.inspect(hcard);
        else this.commit(null);
        return;
      }
      this.selectHand(hcard.dataset.uid);
      return;
    }
    const enemyMinion = t.closest(".opp-board .minion");
    if (enemyMinion && !this.currentTargets().length) { this.inspect(enemyMinion); return; }
    if (sel?.kind === "hand" && sel.isMinion && !sel.placed && t.closest(".my-board, .midline")) {
      sel.position = this.boardPosition(clientX);
      if (sel.targets) { sel.placed = true; sfx.tap(); this.render(); return; }
      this.commit(null);
      return;
    }
    // A spell with no target: tapping the table plays it.
    if (sel?.kind === "hand" && !sel.preview && !sel.isMinion && !sel.targets && t.closest(".my-board, .opp-board, .midline")) {
      this.commit(null);
      return;
    }
    if (t.closest(".hero.me") && !sel) { this.openEmoteMenu(); return; }
    const myMinion = t.closest(".my-board .minion");
    if (myMinion && canAttack(this.state, this.me, myMinion.dataset.uid)) {
      if (sel?.uid === myMinion.dataset.uid) { this.clearSel(); return; }
      this.selectAttacker(myMinion.dataset.uid);
      return;
    }
    if (myMinion && !sel) { this.inspect(myMinion); return; }
    this.clearSel();
  }

  drawArrow(fromEl, x, y) {
    const r = fromEl.getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 3;
    const cx = (sx + x) / 2, cy = Math.min(sy, y) - 60;
    const path = this.arrow.querySelector("path");
    const circle = this.arrow.querySelector("circle");
    path.setAttribute("d", `M${sx},${sy} Q${cx},${cy} ${x},${y}`);
    path.classList.toggle("friendly", false);
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.hidden = false;
    path.style.display = "";
  }

  hideArrow() {
    this.arrow.querySelector("path").setAttribute("d", "");
    this.arrow.querySelector("circle").hidden = true;
  }

  // ---------------------------------------------------------------- inspect / menus
  inspect(el) {
    this.drag = null;
    const uid = el.dataset.uid;
    const s = this.state;
    if (!s) return;
    let def = null, stats = null, shiny = false, notes = [];
    if (el.classList.contains("hero")) {
      const idx = uid === `h${this.me}` ? this.me : this.opp;
      const p = s.players[idx];
      modal(`<h2>${esc(p.name)}</h2><p><b>Health:</b> ${p.hero.hp}/${p.hero.maxHp}${p.hero.armor ? ` · <b>Drip:</b> ${p.hero.armor}` : ""}</p><p><b>Cards in hand:</b> ${p.handCount ?? p.hand.length} · <b>Deck:</b> ${p.deckCount ?? p.deck.length}</p><p><b>${HERO_POWER.name}</b> (${HERO_POWER.cost} Aura): ${HERO_POWER.text}</p><div class="actions"><button class="btn primary" data-close>OK</button></div>`);
      return;
    }
    if (el.classList.contains("hcard")) {
      const inst = s.players[this.me].hand.find(c => c.uid === uid);
      if (!inst) return;
      def = this.def(inst.id); shiny = inst.shiny;
    } else {
      for (const idx of [0, 1]) {
        const m = s.players[idx].board.find(x => x.uid === uid);
        if (m) {
          def = this.def(m.id); shiny = m.shiny;
          stats = { attack: m.attack, health: m.health };
          if (m.frozen) notes.push("🔇 Muted: can't attack this turn.");
          if (m.sick && idx === this.me) notes.push("Just got here: can attack next turn.");
          if (idx === this.me && !m.sick && !m.frozen && m.attacksLeft <= 0 && m.attack > 0) notes.push("Already attacked this turn.");
          if (m.attack <= 0) notes.push("0 Attack: it can't attack. Just here for the vibes.");
          if (m.health < m.maxHealth) notes.push(`Hurt: ${m.health}/${m.maxHealth} Health.`);
          const extraKw = (m.keywords || []).filter(k => !(def?.keywords || []).includes(k));
          if (extraKw.length) notes.push(`Gained: ${extraKw.map(k => KEYWORDS[k]?.label).join(", ")}.`);
          def = def && { ...def, keywords: m.keywords };
        }
      }
    }
    if (!def) return;
    sfx.tap();
    modal(`<div class="inspect">${cardHTML(def, { shiny, stats })}<div class="details">${def.flavor ? `<p><i>${esc(def.flavor)}</i></p>` : ""}${keywordGlossary(def.keywords, def)}${notes.map(n => `<p>${esc(n)}</p>`).join("")}</div><button class="btn primary" data-close>Close</button></div>`, { bare: true });
  }

  openMenu() {
    const log = (this.state?.log || []).slice(-40).reverse().map(l => `<div class="${l.side === this.me ? "me" : l.side === this.opp ? "opp" : ""}">${esc(l.text)}</div>`).join("");
    const m = modal(`<h2>Menu</h2>
      <div class="row" style="margin-bottom:12px">
        <button class="btn small" data-rules>How to play</button>
        <button class="btn small" data-sound>${this.opts.soundOn?.() ? "🔊 Sound on" : "🔇 Sound off"}</button>
      </div>
      <h3>Battle log</h3><div class="log-list">${log || "<div>Nothing yet.</div>"}</div>
      <div class="actions">
        ${this.state?.over ? `<button class="btn" data-leave>Leave</button>` : `<button class="btn danger" data-concede>Give up</button>`}
        <button class="btn primary" data-close>Back to game</button>
      </div>`);
    m.el.querySelector("[data-rules]").onclick = () => { m.close(); this.opts.showRules?.(); };
    m.el.querySelector("[data-sound]").onclick = e => { const on = this.opts.toggleSound?.(); e.target.textContent = on ? "🔊 Sound on" : "🔇 Sound off"; };
    const concede = m.el.querySelector("[data-concede]");
    if (concede) concede.onclick = async () => {
      m.close();
      if (await confirmDialog("Give up?", "This counts as a loss.", { yes: "Give up", danger: true })) this.opts.onConcede?.();
    };
    const leave = m.el.querySelector("[data-leave]");
    if (leave) leave.onclick = () => { m.close(); this.opts.onExit?.(); };
  }

  openEmoteMenu() {
    if (!this.opts.onEmote) return;
    this.closeEmoteMenu();
    const menu = document.createElement("div");
    menu.className = "emote-menu";
    menu.innerHTML = Object.entries(EMOTES).map(([k, v]) => `<button data-emote="${k}">${esc(v)}</button>`).join("");
    const r = this.el.myHero.getBoundingClientRect();
    menu.style.left = `${Math.max(8, r.left)}px`;
    menu.style.bottom = `${window.innerHeight - r.top + 10}px`;
    menu.style.position = "fixed";
    menu.addEventListener("pointerdown", e => e.stopPropagation());
    menu.addEventListener("click", e => {
      const key = e.target.closest("[data-emote]")?.dataset.emote;
      if (key) { this.opts.onEmote(key); this.closeEmoteMenu(); }
    });
    document.body.appendChild(menu);
    this.emoteMenu = menu;
  }

  closeEmoteMenu(e) {
    if (e && this.emoteMenu?.contains(e.target)) return;
    this.emoteMenu?.remove();
    this.emoteMenu = null;
  }

  showEmote(seat, key) {
    const heroEl = seat === this.me ? this.el.myHero : this.el.oppHero;
    const r = heroEl.getBoundingClientRect();
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = EMOTES[key] || key;
    b.style.position = "fixed";
    b.style.left = `${r.right + 8}px`;
    if (seat === this.me) b.style.bottom = `${window.innerHeight - r.top + 4}px`; else b.style.top = `${r.bottom - 10}px`;
    document.body.appendChild(b);
    if (key === "woof") sfx.bark(); else sfx.emote();
    setTimeout(() => b.remove(), 2300);
  }

  // The hero power: a bark, then immediately a fart.
  async barkFart(hero) {
    sfx.barkFart();
    const r = hero.getBoundingClientRect();
    const cx = Math.max(90, Math.min(window.innerWidth - 90, r.left + r.width / 2));
    const bark = document.createElement("div");
    bark.className = "float-num info bark-word";
    bark.textContent = "BARK!";
    bark.style.left = `${cx}px`;
    bark.style.top = `${r.top}px`;
    document.body.appendChild(bark);
    hero.animate([{ transform: "scale(1)" }, { transform: "scale(1.25) rotate(-6deg)" }, { transform: "scale(1)" }], { duration: 260 });
    await sleep(300);
    const gas = document.createElement("div");
    gas.className = "fart-cloud";
    gas.textContent = "💨";
    gas.style.left = `${r.left + r.width * 0.2}px`;
    gas.style.top = `${r.top + r.height * 0.6}px`;
    document.body.appendChild(gas);
    const fart = document.createElement("div");
    fart.className = "float-num fart-word";
    fart.textContent = "FART";
    fart.style.left = `${cx + 20}px`;
    fart.style.top = `${Math.min(window.innerHeight - 60, r.top + r.height)}px`;
    document.body.appendChild(fart);
    hero.animate([{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(3px,-2px)" }, { transform: "translate(0,0)" }], { duration: 300, iterations: 2 });
    buzz([20, 40, 80]);
    setTimeout(() => { bark.remove(); fart.remove(); gas.remove(); }, 1300);
    await sleep(450);
  }

  // Particle burst on a character (hits, knockouts).
  burst(uid, count, kind) {
    const el = this.elFor(uid);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const colors = kind === "poof" ? ["#ffffff", "#ffd34d", "#ff8bd1", "#8ed3ff", "#b28dff"] : ["#ffd34d", "#ff9f45", "#ff5d5d", "#ffffff"];
    for (let i = 0; i < count; i++) {
      const p = document.createElement("i");
      p.className = `particle ${kind}`;
      const angle = Math.random() * Math.PI * 2, dist = 30 + Math.random() * (kind === "poof" ? 70 : 45);
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  screenShake(big) {
    this.root.classList.remove("quake", "quake-big");
    void this.root.offsetWidth;
    this.root.classList.add(big ? "quake-big" : "quake");
    setTimeout(() => this.root.classList.remove("quake", "quake-big"), 500);
  }

  banner(text, kind = "") {
    const el = document.createElement("div");
    el.className = `banner ${kind}`;
    el.innerHTML = `<div>${esc(text)}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1350);
  }

  // ---------------------------------------------------------------- animation
  elFor(uid) { return this.root.querySelector(`[data-uid="${uid}"]`); }

  floatAt(uid, text, kind) {
    const el = this.elFor(uid);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = `float-num ${kind}`;
    f.textContent = text;
    f.style.left = `${r.left + r.width / 2}px`;
    f.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  async lunge(fromUid, toUid) {
    const a = this.elFor(fromUid), b = this.elFor(toUid);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const dx = (rb.left + rb.width / 2) - (ra.left + ra.width / 2);
    const dy = (rb.top + rb.height / 2) - (ra.top + ra.height / 2);
    a.style.zIndex = "20";
    sfx.attack();
    const anim = a.animate([
      { transform: "translate(0,0) scale(1)" },
      { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.15)`, offset: 0.3 },
      { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) scale(1.1)`, offset: 0.65 },
      { transform: "translate(0,0) scale(1)" }
    ], { duration: 520, easing: "ease-in-out" });
    await sleep(340);
    sfx.hit();
    buzz(30);
    await anim.finished.catch(() => {});
    a.style.zIndex = "";
  }

  async reveal(id, shiny) {
    const def = this.def(id);
    if (!def) return;
    const el = document.createElement("div");
    el.className = "reveal";
    el.innerHTML = cardHTML(def, { shiny });
    document.body.appendChild(el);
    await sleep(1750);
    el.remove();
  }

  async playEvents(events) {
    let hits = false;
    for (const e of events) {
      switch (e.t) {
        case "play":
          if (e.player !== this.me) await this.reveal(e.id, e.shiny);
          if (this.def(e.id)?.type === "spell") sfx.spell(); else sfx.play();
          if (this.def(e.id)?.rarity === "legendary") { this.banner(`${this.def(e.id).name}!`, "legend"); sfx.shiny(); }
          break;
        case "attack": await this.lunge(e.from, e.to); break;
        case "power": await this.barkFart(e.player === this.me ? this.el.myHero : this.el.oppHero); break;
        case "damage": {
          hits = true;
          const big = e.amount >= 5;
          this.floatAt(e.uid, `-${e.amount}`, big ? "dmg big" : "dmg");
          const el = this.elFor(e.uid);
          if (el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
          this.burst(e.uid, big ? 14 : 7, "hit");
          if (big) { sfx.vineBoom(); this.screenShake(true); }
          else if (e.uid.startsWith("h")) this.screenShake(false);
          if (e.uid === `h${this.me}`) buzz(big ? [80, 40, 120] : [40, 30, 40]);
          break;
        }
        case "summon": {
          if (e.player !== this.me || !events.some(x => x.t === "play" && x.player === e.player)) sfx.summon();
          break;
        }
        case "heal": this.floatAt(e.uid, `+${e.amount}`, "heal"); sfx.heal(); break;
        case "buff": if (e.attack || e.health) this.floatAt(e.uid, `+${e.attack}/+${e.health}`, "buff"); break;
        case "shield": { sfx.shield(); this.floatAt(e.uid, "Plot armor!", "info"); const el = this.elFor(e.uid); if (el) el.classList.add("pop-shield"); break; }
        case "freeze": this.floatAt(e.uid, "🔇 Muted", "info"); break;
        case "armor": this.floatAt(`h${e.player}`, `+${e.amount} Drip`, "info"); break;
        case "death": { hits = true; const el = this.elFor(e.uid); if (el) el.classList.add("dying"); this.burst(e.uid, 18, "poof"); sfx.death(); break; }
        case "fatigue": toast(`${e.player === this.me ? "You're" : "They're"} out of cards! ${e.amount} burnout damage.`, "bad"); break;
        case "burn": toast(`${e.player === this.me ? "Your" : "Their"} hand was full. ${this.def(e.id)?.name || "A card"} got yeeted into the void.`); break;
        case "timeout": toast(`${e.player === this.me ? "You went AFK" : "They went AFK"}. Turn skipped.`); break;
        default: break;
      }
    }
    if (hits) await sleep(520);
  }

  async postEvents(events, first) {
    for (const e of events) {
      if (e.t === "turn" && !this.state.over) {
        if (e.player === this.me) { this.banner("Your Turn. Lock in."); sfx.turn(); buzz(20); }
        await sleep(e.player === this.me ? 600 : 250);
      }
    }
    if (first && this.state.active === this.me && !this.state.over) { this.banner("Your Turn. Lock in."); sfx.turn(); }
  }
}

// ------------------------------------------------------------------ Solo controller
export class SoloMatch {
  // opts: { catalog, state, level, heroArt, onEnd(result), ui hooks }
  constructor({ catalog, state, level, heroArt, onEnd, showRules, toggleSound, soundOn, onExit }) {
    this.catalog = catalog;
    this.state = state;
    this.level = level;
    this.onEnd = onEnd;
    this.ended = false;
    this.battle = new Battle({
      catalog, me: 0, heroArt,
      onAction: action => this.act(action),
      onEmote: key => { this.battle.showEmote(0, key); if (Math.random() < 0.6) setTimeout(() => this.battle.showEmote(1, key === "gg" ? "gg" : key === "hello" ? "hello" : "woof"), 900); },
      onConcede: () => this.act({ type: "concede" }),
      onExit, showRules, toggleSound, soundOn
    });
    this.battle.update(state, []);
    setTimeout(() => this.battle.showEmote(1, "hello"), 900);
    if (state.active === 1) this.runAi();
  }

  async act(action) {
    const res = applyAction(this.state, this.catalog, 0, action);
    if (!res.ok) return res;
    await this.battle.update(this.state, res.events);
    if (this.state.over) { this.finish(); return res; }
    if (this.state.active === 1) this.runAi();
    return res;
  }

  async runAi() {
    await sleep(500);
    let safety = 0;
    while (!this.state.over && this.state.active === 1 && safety++ < 60 && !this.battle.destroyed) {
      let action = chooseAiAction(this.state, this.catalog, 1, this.level);
      let res = applyAction(this.state, this.catalog, 1, action);
      if (!res.ok) { action = { type: "end" }; res = applyAction(this.state, this.catalog, 1, action); }
      const played = action.type === "play" ? res.events.find(e => e.t === "play") : null;
      await this.battle.update(this.state, res.events);
      if (played && this.catalog[played.id]?.rarity === "legendary" && Math.random() < 0.7) this.battle.showEmote(1, "wow");
      if (action.type !== "end") await sleep(450);
    }
    if (safety >= 60 && !this.state.over && this.state.active === 1) {
      const res = applyAction(this.state, this.catalog, 1, { type: "end" });
      await this.battle.update(this.state, res.events);
    }
    if (this.state.over) this.finish();
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    if (this.state.winner === 0) this.battle.showEmote(1, "gg");
    setTimeout(() => this.onEnd?.({ won: this.state.winner === 0, draw: this.state.winner === "draw" }), 900);
  }

  destroy() { this.battle.destroy(); }
}
