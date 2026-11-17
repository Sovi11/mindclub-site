// Parses share text captured on game pages and logs it with the device key from the site.
// parser.js is a copy of the site's parser.js (tests/extension.test.mjs checks they match).
importScripts("config.js", "parser.js");
const C = self.MINDCLUB_CONFIG;

// Same day rules as the site (app.js: dayKey, daysAgo, resultDay).
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = key => Math.round((new Date(dayKey() + "T12:00") - new Date(key + "T12:00")) / 864e5);
function resultDay(p) {
  const d = puzzleDate(p);
  if (!d) return dayKey();
  const key = dayKey(d);
  return daysAgo(key) < 0 ? dayKey() : key;
}

const siteUrl = C.siteUrl, connectUrl = C.siteUrl + "?connect=extension";
const isSite = url => { try { return new URL(url).href.startsWith(siteUrl); } catch (e) { return false; } };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === "share") {
    handleShare(String(msg.text || "")).then(reply, e => reply({ status: "error", message: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "connect" && sender.tab && isSite(sender.url)) {
    chrome.storage.local.set({ token: msg.token, connectedAt: Date.now() }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.type === "disconnect" && (!sender.tab || isSite(sender.url))) {
    chrome.storage.local.remove("token").then(() => reply({ ok: true }));
    return true;
  }
});

async function handleShare(text) {
  const p = parse(text);
  const g = p && G(p.game);
  if (!g) return null;                                   // not a game result: ignore silently
  const day = resultDay(p), today = dayKey();
  const base = { game: g.name, label: p.label, color: g.color, day, today, siteUrl, connectUrl };

  const { token } = await chrome.storage.local.get("token");
  if (!token) return { ...base, status: "not_connected" };
  if (daysAgo(day) > 1) return { ...base, status: "old" };   // the database only takes yesterday to tomorrow

  const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/log_result_via_token`, {
    method: "POST",
    headers: { apikey: C.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token, p_game: p.game, p_day: day, p_label: p.label,
                           p_score: p.score ?? null, p_puzzle: p.puzzle || null }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || `HTTP ${res.status}`;
    if (/invalid token/i.test(message)) {                 // revoked on the site
      await chrome.storage.local.remove("token");
      return { ...base, status: "not_connected", revoked: true };
    }
    return { ...base, status: "error", message };
  }
  const status = body === "saved" ? "saved" : "exists";
  await remember({ game: p.game, name: g.name, label: p.label, color: g.color, day, status, at: Date.now() });
  if (status === "saved") flashBadge();
  return { ...base, status };
}

async function remember(entry) {
  const { recent = [] } = await chrome.storage.local.get("recent");
  const next = [entry, ...recent.filter(r => !(r.game === entry.game && r.day === entry.day))].slice(0, 12);
  await chrome.storage.local.set({ recent: next });
}

function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#2f7d4f" });
  chrome.action.setBadgeText({ text: "✓" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 8000);
}
