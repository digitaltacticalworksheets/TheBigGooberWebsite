// Guided first match: rigged hands, scripted opponent turns, and a coach that spotlights
// each part of the battle screen. After the script it plays out against the easiest AI.
import { createGame, applyAction } from "./engine.js";
import { SoloMatch } from "./battle.js";
import { HERO_POWERS, KEYWORDS } from "./cards.js";
import { $, esc } from "./ui.js";
import { sfx } from "./sound.js";

const OPP_HP = 15;
const FILLER = ["treat-bonk", "treat-snack-time", "treat-belly-rub", "treat-squeaky-toy", "treat-zoomies", "treat-cozy-blanket", "party-goober", "cool-goober"];

export function createTutorialState(myName) {
  const filler = Array.from({ length: 16 }, (_, i) => FILLER[i % FILLER.length]);
  const state = createGame({ decks: [filler, filler], names: [myName || "You", "Training Dummy"], seed: 12345, firstPlayer: 0 });
  let uid = 1000;
  const inst = id => ({ uid: `t${++uid}`, id, shiny: false });
  const [me, opp] = state.players;
  me.hand = ["cool-goober", "treat-bonk", "treat-drip-check"].map(inst);
  me.deck = ["treat-snack-time", "party-goober", ...filler].map(inst);
  opp.hand = ["token-loaf", "token-pup", "cowboy-goober"].map(inst);
  opp.deck = filler.map(inst);
  opp.hero.hp = OPP_HP;
  me.mulliganDone = opp.mulliganDone = true;
  state.log = [];
  return state;
}

export class TutorialMatch extends SoloMatch {
  constructor(opts) {
    super({ ...opts, level: "sleepy" });
    this.oppTurns = 0;
    this.stepIndex = 0;
    this.steps = buildSteps(this);
    this.coach = new Coach();
    this.showStep();
  }

  // --- lookups used by the steps
  handUid(id) { return this.state.players[0].hand.find(c => c.id === id)?.uid; }
  boardUid(side, id) { return this.state.players[side].board.find(m => m.id === id)?.uid; }
  handEl(id) { return this.battle.el.hand.querySelector(`[data-uid="${this.handUid(id)}"]`); }
  minionEl(side, id) { return (side === 0 ? this.battle.el.myBoard : this.battle.el.oppBoard).querySelector(`[data-uid="${this.boardUid(side, id)}"]`); }

  get step() { return this.steps[this.stepIndex] || null; }

  showStep() {
    const step = this.step;
    if (!step) { this.coach.hide(); return; }
    this.coach.show(step, () => { this.stepIndex++; this.showStep(); });
  }

  async act(action) {
    const step = this.step;
    if (step && action.type !== "concede") {
      if (!step.expect) return { ok: false, error: "Read the tip first, then tap Next." };
      if (!step.expect(action)) return { ok: false, error: step.hint || "Follow the tip for now." };
    }
    this.coach.hide();
    const res = applyAction(this.state, this.catalog, 0, action);
    if (!res.ok) { if (step) this.showStep(); return res; }
    await this.battle.update(this.state, res.events);
    if (this.state.over) { this.coach.hide(); this.stepIndex = this.steps.length; this.finish(); return res; }
    if (this.state.active === 1) await this.runAi();
    if (this.state.over) return res;
    if (step) { this.stepIndex++; this.showStep(); }
    return res;
  }

  async runAi() {
    const script = OPP_SCRIPT[this.oppTurns++];
    if (!script || this.stepIndex >= this.steps.length) return super.runAi();
    await new Promise(r => setTimeout(r, 600));
    for (const make of [...script, () => ({ type: "end" })]) {
      if (this.battle.destroyed || this.state.over) return;
      const action = make(this);
      if (!action) continue;
      const res = applyAction(this.state, this.catalog, 1, action);
      if (!res.ok) continue;
      await this.battle.update(this.state, res.events);
      await new Promise(r => setTimeout(r, 500));
    }
    if (this.state.over) this.finish();
  }

  destroy() { this.coach.hide(); super.destroy(); }
}

const oppHand = (t, id) => t.state.players[1].hand.find(c => c.id === id)?.uid;
const OPP_SCRIPT = [
  [t => ({ type: "play", uid: oppHand(t, "token-loaf") }), t => ({ type: "play", uid: oppHand(t, "token-pup") })],
  [t => ({ type: "play", uid: oppHand(t, "cowboy-goober"), target: "h0" })]
];

function buildSteps(t) {
  const b = t.battle.el;
  const info = (target, text) => ({ target, text });
  const doIt = (target, text, expect, hint) => ({ target, text, expect, hint });
  const kw = k => `${KEYWORDS[k].icon} <b>${KEYWORDS[k].label}</b>`;
  return [
    info(() => b.oppHero, `This is the enemy hero. Knock their Health (the red number) down to <b>0</b> to win.`),
    info(() => b.myHero, `This is you. Protect your Health. Grey <b>Drip</b> (armor) shows up here too and soaks damage first.`),
    info(() => $(".mana", b.myBar), `This is your <b>Aura</b>. Cards cost Aura (the number in their top-left corner). You get 1 more each turn, up to 10.`),
    info(() => b.hand, `This is your hand. Tap a card to read it. Press and hold any card to see it up close.`),
    doIt(() => t.handEl("cool-goober"), `Play <b>Cool Goober</b>: tap it, then tap the table. You can also drag it up.`,
      a => a.type === "play" && a.uid === t.handUid("cool-goober"), "Play Cool Goober first."),
    info(() => t.minionEl(0, "cool-goober"), `Goobers show <b>Attack</b> (yellow) and <b>Health</b> (red). New Goobers are sleepy and can't attack until your next turn. Cool Goober has ${kw("sneaky")}: enemies can't target it until it attacks.`),
    doIt(() => b.end, `You're out of Aura. Tap <b>End Turn</b>.`, a => a.type === "end", "Tap End Turn."),

    info(() => t.minionEl(1, "token-loaf"), `They played a Loaf with ${kw("guard")}. You have to attack Tanks first, so their hero and Lil Goober are safe for now.`),
    doIt(() => t.minionEl(0, "cool-goober"), `Attack! Tap Cool Goober, then tap the Loaf. You can also drag an arrow.`,
      a => a.type === "attack" && a.uid === t.boardUid(0, "cool-goober"), "Attack the Loaf with Cool Goober."),
    info(() => t.minionEl(1, "token-loaf"), `When Goobers fight, each one deals its Attack to the other. The Loaf has 0 Attack, so Cool Goober is fine. The Loaf is down to 2 Health.`),
    doIt(() => t.handEl("treat-bonk"), `Spells are one-time effects. Tap <b>Bonk</b>, then tap the Loaf to finish it.`,
      a => a.type === "play" && a.uid === t.handUid("treat-bonk") && a.target === t.boardUid(1, "token-loaf"), "Bonk the Loaf."),
    doIt(() => b.power, `This is your hero power, <b>${esc(HERO_POWERS.classic.name)}</b>. Once per turn, pay ${HERO_POWERS.classic.cost} Aura to deal 1 damage. Tap it, then blast Lil Goober.`,
      a => a.type === "power" && a.target === t.boardUid(1, "token-pup"), "Use BARK FART on Lil Goober."),
    doIt(() => b.end, `Nice. When the <b>End Turn</b> button glows, you have nothing left to do. End your turn.`, a => a.type === "end", "Tap End Turn."),

    info(() => b.myHero, `Ouch. Cowboy Goober has 📣 <b>Entrance</b>, an effect that happens when it's played. It dealt 2 damage to you.`),
    doIt(() => t.handEl("party-goober"), `Hit back. Play <b>Party Goober</b>. Its Entrance brings a Lil Goober with it.`,
      a => a.type === "play" && a.uid === t.handUid("party-goober"), "Play Party Goober."),
    info(() => b.history, `Every card played shows up here. Tap one to see what it did.`),
    info(() => b.myBoard, `Small icons on a Goober mean extra powers, like ☠️ <b>Last Words</b> (happens when it's knocked out). Press and hold any Goober to read them.`),
    info(() => t.handEl("treat-drip-check"), `<b>Drip Check</b> gives your hero armor. Save it for when you need defense.`),
    info(() => $("[data-menu]", t.battle.root), `The menu has the rules, sound, the battle log, and Give Up.`),
    info(() => b.oppHero, `That's everything. The rest of this game is yours: take their hero down to 0. 🫡`)
  ];
}

class Coach {
  constructor() { this.el = null; this.raf = 0; }

  show(step, next) {
    this.hide();
    const el = document.createElement("div");
    el.className = `coach${step.expect ? "" : " blocking"}`;
    el.innerHTML = `<div class="coach-ring"></div><div class="coach-bubble" role="dialog"><p>${step.text}</p>${step.expect ? `<small>Your move 👆</small>` : `<button class="btn primary small" data-next>Next</button>`}</div>`;
    document.body.appendChild(el);
    this.el = el;
    const btn = el.querySelector("[data-next]");
    if (btn) btn.onclick = () => { sfx.tap(); next(); };
    const ring = el.querySelector(".coach-ring"), bubble = el.querySelector(".coach-bubble");
    const place = () => {
      if (this.el !== el) return;
      const target = step.target?.();
      if (target && target.isConnected) {
        const r = target.getBoundingClientRect(), pad = 6;
        Object.assign(ring.style, { display: "block", left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 14;
        const below = r.top + r.height / 2 < innerHeight / 2;
        let top = below ? r.bottom + pad + gap : r.top - pad - gap - bh;
        top = Math.max(8, Math.min(innerHeight - bh - 8, top));
        const left = Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
        Object.assign(bubble.style, { left: `${left}px`, top: `${top}px` });
      } else {
        ring.style.display = "none";
        Object.assign(bubble.style, { left: `${Math.max(8, (innerWidth - bubble.offsetWidth) / 2)}px`, top: `${(innerHeight - bubble.offsetHeight) / 2}px` });
      }
      this.raf = requestAnimationFrame(place);
    };
    place();
  }

  hide() {
    cancelAnimationFrame(this.raf);
    this.el?.remove();
    this.el = null;
  }
}
