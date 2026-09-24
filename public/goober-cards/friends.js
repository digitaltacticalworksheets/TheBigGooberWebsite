// Friends: the online connection (so friends see you online and can invite you)
// and the friend-list actions. Logged-in players only.
import { sessionToken } from "./account.js";

async function call(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api/friends${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken()}` },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
  } catch {
    return { ok: false, error: "Can't reach the server. Check your connection." };
  }
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, ...data } : { ok: false, status: res.status, ...data, error: data.error || "That didn't work." };
}

export const friendsApi = {
  list: () => call(""),
  request: username => call("/request", { method: "POST", body: { username } }),
  accept: id => call("/accept", { method: "POST", body: { id } }),
  decline: id => call("/decline", { method: "POST", body: { id } }),
  cancel: id => call("/cancel", { method: "POST", body: { id } }),
  remove: id => call("/remove", { method: "POST", body: { id } }),
  invite: (id, roomCode) => call("/invite", { method: "POST", body: { id, roomCode } })
};

// One connection per open game. It reconnects on its own, pings to stay "online",
// and re-sends what you're doing after reconnecting.
let ws = null, ping = null, retry = null, tries = 0, wanted = false, handler = () => {};
let current = { status: "online", roomCode: "" };

function open() {
  if (!wanted || !sessionToken()) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const sock = new WebSocket(`${proto}//${location.host}/api/friends/presence?${new URLSearchParams({ auth: sessionToken() })}`);
  ws = sock;
  sock.addEventListener("open", () => { tries = 0; sendStatus(); });
  sock.addEventListener("message", event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== "pong") handler(msg);
  });
  sock.addEventListener("close", () => {
    if (ws !== sock) return;
    ws = null;
    if (!wanted) return;
    tries += 1;
    clearTimeout(retry);
    retry = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(tries, 5)));
  });
}

function sendStatus() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "status", ...current }));
}

export function startPresence(onMessage) {
  handler = onMessage || (() => {});
  if (wanted && ws) return;
  wanted = true;
  open();
  clearInterval(ping);
  // Must match the server's auto-response exactly, so pings don't wake it.
  ping = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); }, 30000);
}

export function stopPresence() {
  wanted = false;
  clearInterval(ping);
  clearTimeout(retry);
  try { ws?.close(); } catch { /* already closed */ }
  ws = null;
}

// What you're doing: "online" | "solo" | "searching" | "watching" | "playing" (+ room code).
export function setPresence(status, roomCode = "") {
  if (current.status === status && current.roomCode === roomCode) return;
  current = { status, roomCode };
  sendStatus();
}

export const STATUS_LABEL = { online: "Online", solo: "Playing solo", searching: "Looking for a match", watching: "Watching a match", playing: "In a match", offline: "Offline" };
