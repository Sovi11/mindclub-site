// Renders the Chrome Web Store images from the real extension and site.
// usage: node store/shoot.mjs "<chrome.exe>"     (needs the site served at http://localhost:8765, e.g. python -m http.server 8765)
// Uses CDP over a pipe because Chrome 137+ ignores --load-extension; Extensions.loadUnpacked needs the pipe.
// Supabase is stubbed inside the extension, so nothing reaches the live database.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..", "extension");
const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const proc = spawn(chromePath, [`--user-data-dir=${mkdtempSync(join(tmpdir(), "mc-shoot-"))}`, "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging", "--headless=new", "--no-first-run", "--hide-scrollbars", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log("timed out"); proc.kill(); process.exit(2); }, 180000).unref();

let id = 0, buf = ""; const pending = new Map();
proc.stdio[4].on("data", c => { buf += c; let i; while ((i = buf.indexOf("\0")) >= 0) { const d = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(d.id)?.(d); pending.delete(d.id); } });
const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, d => d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result));
  proc.stdio[3].write(JSON.stringify({ id: i, method, params, sessionId }) + "\0");
});
const ev = async (s, expression) => (await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s)).result.value;
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };

async function page(url, width, height, scale = 1) {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  await cmd("Page.enable", {}, sessionId);
  await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
  await cmd("Page.navigate", { url }, sessionId);
  await until(async () => (await ev(sessionId, "document.readyState").catch(() => "")) === "complete", 20000);
  await ev(sessionId, "document.fonts.ready.then(() => true)").catch(() => 0);
  return sessionId;
}
const shot = async (s, file, clip) => {
  const { data } = await cmd("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, s);
  writeFileSync(join(here, file), Buffer.from(data, "base64")); console.log("wrote", file);
};

try {
  const { id: ext } = await cmd("Extensions.loadUnpacked", { path: extDir });
  let sw;
  await until(async () => {
    const t = (await cmd("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${ext}/background.js`);
    if (t) sw = (await cmd("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
    return !!sw;
  });
  const now = Date.now(), today = new Date().toLocaleDateString("en-CA");
  const recent = [["wordle", "Wordle", "3/6", "#6aaa64"], ["connections", "Connections", "Perfect", "#9a83cf"],
    ["quordle", "Quordle", "3·6·7·5", "#c4552b"], ["queens", "Queens", "1:07", "#d98a3a"]]
    .map(([game, name, label, color], i) => ({ game, name, label, color, day: today, status: "saved", at: now - i * 6e5 }));
  await ev(sw, `self.fetch = async () => new Response('"saved"', { status: 200, headers: { "content-type": "application/json" } });
    chrome.storage.local.set({ token: "${"d".repeat(64)}", recent: ${JSON.stringify(recent)} }).then(() => true)`);
  const stored = await ev(sw, "chrome.storage.local.get('token').then(r => !!r.token)");
  if (!stored) throw new Error("test key was not stored in the extension");

  // 1. Toast on a real game page
  const game = await page("https://krillion.io/", 1280, 800);
  await sleep(2500);
  // Dismiss the consent banner the way a privacy-minded visitor would, so the page is visible.
  const reject = await ev(game, `(() => {
    const find = root => { for (const el of root.querySelectorAll("*")) {
      if (/^(button|a)$/i.test(el.tagName) && /^reject all$/i.test(el.textContent.trim())) return el;
      if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const b = find(document); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (reject) for (const type of ["mousePressed", "mouseReleased"])
    await cmd("Input.dispatchMouseEvent", { type, x: reject.x, y: reject.y, button: "left", clickCount: 1 }, game);
  console.log("consent banner", reject ? "rejected" : "not found");
  await sleep(800);
  const n = Math.round((new Date().setHours(12, 0, 0, 0) - new Date("2026-07-15T12:00")) / 864e5);
  await ev(game, `navigator.clipboard.writeText(${JSON.stringify(`Krillion #${n} 🦐
430

🦐🐙🐟🦑🐠🐳🦐`)}).catch(() => 0); true`);
  await until(() => ev(game, "!!document.getElementById('mindclub-toast')"));
  await sleep(400);
  await shot(game, "screenshot-1-toast.png");

  // 2. Popup, then framed with a caption
  const pop = await page(`chrome-extension://${ext}/popup.html`, 320, 600, 2);
  const h = await ev(pop, "Math.ceil(document.body.getBoundingClientRect().height)");
  await shot(pop, "raw-popup.png", { x: 0, y: 0, width: 320, height: h });
  const frame = await page(pathToFileURL(join(here, "frame-popup.html")).href, 1280, 800);
  await shot(frame, "screenshot-2-popup.png");

  // 3. The site with sample friends (state injected; nothing is fetched)
  const site = await page("http://localhost:8765/", 1280, 800);
  await sleep(1200);
  await ev(site, `(() => {
    const today = dayKey(), at = new Date().toISOString(), y = dayKey(addDays(new Date(), -1));
    sb.rpc = async () => ({ data: [], error: null });
    S.user = { id: "me", email: "alex@example.com", is_anonymous: false };
    S.profile = { id: "me", display_name: "Alex", handle: "alex", games: ["wordle","connections","quordle","queens","strands","waffle"] };
    S.people = [{ user_id: "u1", display_name: "Maya", handle: "maya", i_follow: true, follows_me: true },
                { user_id: "u2", display_name: "Sam", handle: "sam_k", i_follow: true, follows_me: true },
                { user_id: "u3", display_name: "Riya", handle: "riya", i_follow: true, follows_me: false }];
    const mine = [["wordle", "3/6", 3], ["connections", "Perfect", 0], ["quordle", "3·6·7·5", 21], ["queens", "1:07", 67]];
    S.mine = mine.map(([game, label, score]) => ({ game, day: today, label, score, created_at: at }));
    const row = (user_id, game, label, score, day = today) => ({ user_id, game, day, revealed: true, label, score, created_at: at });
    S.board = [...mine.map(([g, l, s]) => row("me", g, l, s)),
      row("u1", "wordle", "4/6", 4), row("u2", "wordle", "3/6", 3), row("u3", "wordle", "5/6", 5),
      row("u1", "connections", "1 mistake", 1), row("u2", "quordle", "4·5·8·6", 23), row("u1", "queens", "0:58", 58),
      row("u1", "wordle", "2/6", 2, y), row("me", "wordle", "4/6", 4, y), row("u2", "waffle", "3/5 ★", -3, y), row("u1", "waffle", "5/5 ★", -5, y)];
    S.challenges = [];
    document.getElementById("authScreen").hidden = true; document.getElementById("appScreen").hidden = false;
    render();
    document.querySelectorAll(".profileLink").forEach(el => el.textContent = "https://sovi11.github.io/mindclub-site/?u=alex");
    return true; })()`);
  await sleep(500);
  await shot(site, "screenshot-3-site.png");

  // 4. Small promo tile
  const promo = await page(pathToFileURL(join(here, "promo-small.html")).href, 440, 280);
  await shot(promo, "promo-small.png");
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  proc.kill();
}
