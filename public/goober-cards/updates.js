// Pick up new deploys without anyone having to hard refresh. /version.json changes
// with every release; when it no longer matches the one this page loaded with, the
// page reloads itself the next time that's safe (never mid-match or mid-typing).
const CHECK_EVERY_MS = 5 * 60 * 1000;

async function fetchVersion() {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

export function watchForUpdates({ canReload = () => true } = {}) {
  let loaded = null, pending = false;
  fetchVersion().then(v => { loaded = v; });

  const maybeReload = () => { if (pending && canReload()) location.reload(); };
  const check = async () => {
    if (pending) { maybeReload(); return; }
    const latest = await fetchVersion();
    if (!latest) return;
    if (!loaded) { loaded = latest; return; }
    if (latest !== loaded) { pending = true; maybeReload(); }
  };

  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  setInterval(check, CHECK_EVERY_MS);
  // Call this when the page reaches a safe moment (e.g. back on a menu after a match).
  return { maybeReload, check };
}
