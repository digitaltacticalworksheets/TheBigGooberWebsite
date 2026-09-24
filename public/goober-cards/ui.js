// Shared UI helpers: card rendering, toasts, modals.
import { KEYWORDS, STATUS, CATEGORY_STYLE, RARITY_LABEL, TRIGGER_LABEL } from "./cards.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

export function artHTML(card) {
  if (card?.art?.image) return `<img src="${esc(card.art.image)}" alt="" loading="lazy" decoding="async" draggable="false">`;
  return `<span class="emoji">${esc(card?.art?.emoji || "🐶")}</span>`;
}

export function catColor(card) { return (CATEGORY_STYLE[card?.category] || CATEGORY_STYLE.random).color; }

// Highlight keyword names and trigger labels in rules text.
function richText(text) {
  let out = esc(text);
  for (const kw of Object.values(KEYWORDS)) out = out.replace(new RegExp(`\\b${kw.label}\\b`, "g"), `<b>${kw.label}</b>`);
  for (const label of Object.values(TRIGGER_LABEL)) out = out.split(label).join(`<b>${label}</b>`);
  return out;
}

// A full card face. opts: { shiny, stats: {attack, health, cost}, extraClass }
export function cardHTML(card, opts = {}) {
  if (!card) return `<div class="card back"><div class="frame"></div></div>`;
  const cls = ["card", card.rarity, card.type === "spell" ? "is-spell" : "is-minion", opts.shiny ? "shiny" : "", opts.extraClass || ""].filter(Boolean).join(" ");
  const cat = CATEGORY_STYLE[card.category] || CATEGORY_STYLE.random;
  const cost = opts.stats?.cost ?? card.cost;
  const tribe = card.type === "spell" ? "⚡ Spell" : card.token ? "🐶 Token" : `${cat.icon} ${card.category}`;
  const stats = card.type === "minion"
    ? `<div class="atk">${opts.stats?.attack ?? card.attack}</div><div class="hp">${opts.stats?.health ?? card.health}</div>`
    : "";
  const text = card.text || (card.flavor ? `<i>${esc(card.flavor)}</i>` : "");
  return `<div class="${cls}" style="--cat:${cat.color}">
    <div class="frame">
      <div class="art">${artHTML(card)}</div>
      <div class="name"><span>${esc(card.name)}</span></div>
      <div class="gem" title="${RARITY_LABEL[card.rarity] || ""}"></div>
      <div class="text"><span>${card.text ? richText(card.text) : text}</span></div>
      <div class="tribe">${esc(tribe)}</div>
    </div>
    <div class="cost">${cost}</div>${stats}
  </div>`;
}

export function cardBackHTML() { return `<div class="card back"><div class="frame"></div></div>`; }

let toastWrap = null;
export function toast(message, kind = "") {
  if (!toastWrap) { toastWrap = document.createElement("div"); toastWrap.className = "toast-wrap"; document.body.appendChild(toastWrap); }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastWrap.appendChild(el);
  while (toastWrap.children.length > 3) toastWrap.firstChild.remove();
  setTimeout(() => el.remove(), 2600);
}

// Show a modal. `html` is inserted into a sheet; returns { el, close }.
export function modal(html, { onClose, className = "", dismissable = true, bare = false } = {}) {
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = bare ? html : `<div class="sheet ${className}">${html}</div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    onClose?.();
  };
  if (dismissable) el.addEventListener("click", event => { if (event.target === el) close(); });
  el.addEventListener("click", event => { if (event.target.closest("[data-close]")) close(); });
  document.body.appendChild(el);
  return { el, close };
}

export function confirmDialog(title, body, { yes = "Yes", no = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button class="btn" data-no>${esc(no)}</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(yes)}</button></div>`, {
      onClose: () => { if (!answered) resolve(false); }
    });
    m.el.querySelector("[data-yes]").onclick = () => { answered = true; m.close(); resolve(true); };
    m.el.querySelector("[data-no]").onclick = () => { answered = true; m.close(); resolve(false); };
  });
}

export function keywordGlossary(keywords = [], card = null) {
  const line = k => `<p class="kw-line"><b>${k.icon} ${k.label}</b><span>${k.text}</span></p>`;
  const effect = card?.effect || card?.ability;
  const granted = effect?.keyword && !keywords.includes(effect.keyword) ? [effect.keyword] : [];
  const lines = [...keywords, ...granted].filter(k => KEYWORDS[k]).map(k => line(KEYWORDS[k]));
  if (effect?.type === "freeze" || effect?.freeze) lines.push(line(STATUS.muted));
  if (effect?.type === "silence") lines.push(line(STATUS.shadowbanned));
  const trig = card?.ability?.trigger;
  if (trig === "battlecry") lines.push(`<p class="kw-line"><b>📣 Entrance</b><span>Happens when you play this card from your hand.</span></p>`);
  if (trig === "lastBark") lines.push(`<p class="kw-line"><b>☠️ Last Words</b><span>Happens when this Goober gets knocked out.</span></p>`);
  if (trig === "endTurn") lines.push(`<p class="kw-line"><b>⏳ End of turn</b><span>Happens at the end of each of your turns.</span></p>`);
  return lines.join("");
}

// Long-press detection that also swallows the click that follows it.
export function onLongPress(root, selector, handler, ms = 420) {
  let timer = null, startX = 0, startY = 0, fired = false, target = null;
  root.addEventListener("pointerdown", event => {
    target = event.target.closest(selector);
    if (!target) return;
    fired = false;
    startX = event.clientX; startY = event.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; handler(target, event); }, ms);
  });
  const cancel = () => clearTimeout(timer);
  root.addEventListener("pointermove", event => { if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel(); });
  root.addEventListener("pointerup", cancel);
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("click", event => { if (fired) { event.stopPropagation(); event.preventDefault(); fired = false; } }, true);
  root.addEventListener("contextmenu", event => { if (event.target.closest(selector)) event.preventDefault(); });
  return () => fired;
}
