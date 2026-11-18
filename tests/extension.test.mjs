// node --test tests/*.test.mjs
// Runs the extension's background worker in a sandbox with a fake chrome API and fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");

test("extension/parser.js is an exact copy of parser.js", () => {
  assert.equal(read("extension/parser.js"), read("parser.js"), "run: cp parser.js extension/parser.js");
});

test("manifest content-script files exist and match config", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  for (const cs of m.content_scripts) for (const f of cs.js) read("extension/" + f);
  const cfg = read("extension/config.js");
  assert.ok(m.content_scripts[0].matches[0].startsWith(/siteUrl: "([^"]+)"/.exec(cfg)[1]));
  assert.ok(m.host_permissions[0].startsWith(/supabaseUrl: "([^"]+)"/.exec(cfg)[1]));
});

function worker({ token = null, rpc = () => ({ status: 200, body: "saved" }) } = {}) {
  const store = token ? { token } : {};
  const calls = [];
  let listener;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener: f => (listener = f) } },
    storage: { local: {
      get: async k => Object.fromEntries([k].flat().filter(x => x in store).map(x => [x, store[x]])),
      set: async o => Object.assign(store, o),
      remove: async k => { delete store[k]; },
    } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  };
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = rpc(JSON.parse(init.body));
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  const ctx = vm.createContext({ chrome, fetch, setTimeout, console, URL, Date, JSON, Math, Promise });
  ctx.self = ctx;
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(read("extension/" + f), ctx, { filename: f }));
  vm.runInContext(read("extension/background.js"), ctx, { filename: "background.js" });
  const send = (msg, sender = { id: "ext" }) => new Promise(res => {
    if (listener(msg, sender, res) !== true) res(undefined);
  });
  return { send, store, calls };
}

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const TOKEN = "a".repeat(64);

test("non-result text is ignored", async () => {
  const w = worker({ token: TOKEN });
  assert.equal(await w.send({ type: "share", text: "hello world" }), null);
  assert.equal(w.calls.length, 0);
});

test("without a key it asks to connect and calls nothing", async () => {
  const w = worker();
  const r = await w.send({ type: "share", text: "Zip #250 | 0:18 🏁" });
  assert.equal(r.status, "not_connected");
  assert.match(r.connectUrl, /\?connect=extension$/);
  assert.equal(w.calls.length, 0);
});

test("logs a result with the right RPC payload", async () => {
  const w = worker({ token: TOKEN });
  const r = await w.send({ type: "share", text: "Queens #571 | 1:07 👑\nlnkd.in/queens" });
  assert.equal(r.status, "saved");
  assert.equal(r.game, "Queens");
  assert.equal(w.calls.length, 1);
  assert.match(w.calls[0].url, /\/rest\/v1\/rpc\/log_result_via_token$/);
  assert.equal(w.calls[0].init.headers.apikey.startsWith("sb_publishable_"), true);
  assert.deepEqual(w.calls[0].body, { p_token: TOKEN, p_game: "queens", p_day: today, p_label: "1:07", p_score: 67, p_puzzle: "571" });
  assert.equal(w.store.recent[0].label, "1:07");
});

test("already logged is reported, not overwritten", async () => {
  const w = worker({ token: TOKEN, rpc: () => ({ status: 200, body: "exists" }) });
  assert.equal((await w.send({ type: "share", text: "I solved the 11/12/2026 New York Times Mini Crossword in 0:49!" })).status, "exists");
});

test("a revoked key is forgotten", async () => {
  const w = worker({ token: TOKEN, rpc: () => ({ status: 400, body: { message: "invalid token" } }) });
  const r = await w.send({ type: "share", text: "Zip #250 | 0:18 🏁" });
  assert.equal(r.status, "not_connected");
  assert.equal(r.revoked, true);
  assert.equal(w.store.token, undefined);
});

test("an old dated puzzle is not sent", async () => {
  const w = worker({ token: TOKEN });
  const r = await w.send({ type: "share", text: "Wordle 1,000 3/6\n\n🟩🟩🟩🟩🟩" });
  assert.equal(r.status, "old");
  assert.equal(w.calls.length, 0);
});

test("connect is only accepted from the Mindclub site", async () => {
  const w = worker();
  const site = { id: "ext", tab: {}, url: "https://sovi11.github.io/mindclub-site/?x=1" };
  const other = { id: "ext", tab: {}, url: "https://sovi11.github.io/other-repo/" };
  assert.equal(await w.send({ type: "connect", token: TOKEN }, other), undefined);
  assert.equal(w.store.token, undefined);
  assert.equal((await w.send({ type: "connect", token: TOKEN }, site))?.ok, true);
  assert.equal(w.store.token, TOKEN);
  await w.send({ type: "disconnect" }, other);
  assert.equal(w.store.token, TOKEN);
  await w.send({ type: "disconnect" }, site);
  assert.equal(w.store.token, undefined);
});
