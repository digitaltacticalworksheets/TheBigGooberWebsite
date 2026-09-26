// Player accounts: username + password logins and cloud saves of the profile.
import * as store from "./collection.js";
import { adoptOnDevice as econ_adopt } from "./economy.js";

const TOKEN_KEY = "gooberCardsSession";
const USER_KEY = "gooberCardsUser";
const VERSION_KEY = "gooberCardsCloudVersion";

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* blocked */ } };

let listeners = { status: () => {}, replaced: () => {}, expired: () => {} };
let timer = null;
let saving = false;
let dirty = false;

export function currentUser() {
  try { return JSON.parse(read(USER_KEY) || "null"); } catch { return null; }
}
function token() { return read(TOKEN_KEY); }
export function sessionToken() { return token() || ""; }
const loggedIn = () => Boolean(token());
function version() { return Number(read(VERSION_KEY)) || 0; }

async function api(path, { method = "GET", body, keepalive = false } = {}) {
  const headers = { "content-type": "application/json" };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", keepalive });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function setSession(tok, user) {
  write(TOKEN_KEY, tok);
  write(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
  write(VERSION_KEY, null);
}

export function onAccountEvents(handlers) { listeners = { ...listeners, ...handlers }; }

// Pull the account's saved progress onto this device (or upload this device's
// progress if the account has none yet).
async function adoptCloudProfile() {
  const res = await api("/api/profile");
  if (res.status === 401) { expire(); return; }
  if (!res.ok) throw new Error(res.data.error || "Couldn't load your save.");
  if (res.data.data) {
    store.replaceProfile(res.data.data);
    write(VERSION_KEY, String(res.data.version));
  } else {
    write(VERSION_KEY, "0");
    await pushNow();
  }
  const user = currentUser();
  if (user) store.loadProfile().name = user.username;
}

export async function signup(username, password) {
  const profile = { ...store.loadProfile(), name: username };
  const res = await api("/api/auth/signup", { method: "POST", body: { username, password, profile } });
  if (!res.ok) throw new Error(res.data.error || "Couldn't make that account.");
  setSession(res.data.token, res.data.user);
  write(VERSION_KEY, "1");
  store.loadProfile().name = res.data.user.username;
  store.saveProfile();
  return res.data.user;
}

export async function login(username, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { username, password } });
  if (!res.ok) throw new Error(res.data.error || "Couldn't log in.");
  setSession(res.data.token, res.data.user);
  await adoptCloudProfile();
  return res.data.user;
}

export async function logout() {
  await flush();
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* offline: token just expires */ }
  clearSession();
  store.resetProfile();
}

// On page load: make sure the session still works and grab the latest save.
export async function resume() {
  if (!token()) return null;
  try {
    const me = await api("/api/auth/me");
    if (me.status === 401) { expire(); return null; }
    if (!me.ok) return currentUser();
    write(USER_KEY, JSON.stringify(me.data.user));
    await adoptCloudProfile();
    return me.data.user;
  } catch {
    listeners.status("offline");
    return currentUser();
  }
}

function expire() {
  clearSession();
  listeners.expired();
}

async function pushNow({ keepalive = false } = {}) {
  if (!token()) return;
  if (saving) { dirty = true; return; }
  saving = true;
  dirty = false;
  listeners.status("saving");
  try {
    const local = store.loadProfile();
    const sentSeen = [...(local.seenQueue || [])];
    const res = await api("/api/profile", { method: "PUT", body: { data: local, editsRev: local.editsRev || 0 }, keepalive });
    if (res.ok) {
      write(VERSION_KEY, String(res.data.version));
      // The server owns coins/cards/packs; keep its numbers, keep any edits made meanwhile.
      if (res.data.profile) {
        const adopted = store.adoptServerProfile(res.data.profile);
        adopted.seenQueue = (adopted.seenQueue || []).filter(id => !sentSeen.includes(id));
        store.replaceProfile(adopted);
      }
      listeners.status("saved");
    } else if (res.status === 409 && res.data.profile) {
      // Another device changed decks/settings more recently: take those, keep badge clears.
      store.replaceProfile(econ_adopt(res.data.profile, { seenQueue: local.seenQueue }));
      write(VERSION_KEY, String(res.data.version));
      listeners.replaced();
      listeners.status("saved");
      if ((local.seenQueue || []).length) schedule();
    } else if (res.status === 401) expire();
    else listeners.status("offline");
  } catch {
    listeners.status("offline");
  } finally {
    saving = false;
    if (dirty) schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; pushNow(); }, 1200);
}

export async function flush() {
  if (!timer && !dirty) return;
  clearTimeout(timer);
  timer = null;
  await pushNow({ keepalive: true });
}

// --- Economy: the server decides for logged-in players; guests run locally. ---------
async function serverEcon(action, body = {}) {
  let res;
  try {
    res = await api(`/api/econ/${action}`, { method: "POST", body });
  } catch {
    return { ok: false, error: "Can't reach the server. Check your connection." };
  }
  if (res.status === 401) { expire(); return { ok: false, error: "Please log in again." }; }
  if (res.data.profile) {
    store.adoptServerProfile(res.data.profile);
    write(VERSION_KEY, String(res.data.version));
  }
  if (!res.ok) return { ok: false, error: res.data.error || "That didn't work." };
  return { ok: true, ...(res.data.result || {}) };
}

export const econ = {
  async claimDaily() {
    if (!loggedIn()) return store.claimDaily();
    const r = await serverEcon("daily");
    return r.ok ? { packs: 1 } : null;
  },
  async buyPack(type) { return loggedIn() ? serverEcon("buy", { type }) : store.buyPack(type); },
  async openPack(type, catalog) { return loggedIn() ? serverEcon("open", { type }) : store.openPack(type, catalog); },
  async craftCard(id, catalog) { return loggedIn() ? serverEcon("craft", { id }) : store.craftCard(id, catalog); },
  async recycleExtras(catalog) { return loggedIn() ? serverEcon("recycle") : store.recycleExtras(catalog); },
  // Solo matches get a server ticket so rewards are only paid for real games.
  async startSolo(level) {
    if (!loggedIn()) return null;
    const r = await serverEcon("solo-start", { level });
    return r.ok ? r.ticket : null;
  },
  async finishSolo({ ticket, won, draw, reward, level }) {
    if (!loggedIn()) return store.recordResult({ won, reward, level });
    if (!ticket) return { ok: false, coins: 0 };
    const r = await serverEcon("solo-finish", { ticket, won, draw });
    return r.ok ? r : { ...r, coins: 0 };
  },
  // Ask the server whether you uploaded this card's Goober (older uploads are checked
  // against the uploader saved with the image). Updates the profile if so.
  async checkCreator(id) { return loggedIn() ? serverEcon("creator-check", { id }) : { ok: false }; },
  // Online rewards are paid by the game server; pull the updated profile.
  async refresh() {
    if (!loggedIn()) return;
    try {
      const res = await api("/api/profile");
      if (res.ok && res.data.data) { store.adoptServerProfile(res.data.data); write(VERSION_KEY, String(res.data.version)); }
    } catch { /* offline */ }
  },
  isServer: () => loggedIn()
};

// Every local save gets synced (debounced) while logged in.
store.setSaveHook(() => { if (token()) schedule(); });
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}
