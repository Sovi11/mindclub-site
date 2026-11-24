// node --test tests/*.test.mjs
// Pure functions from the site, pulled out of app.js and run with stand-in state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const fn = name => app.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n`))[0];

function board({ me = "me", follow = [], rows = [] }) {
  const ctx = vm.createContext({
    FAIL: 1000000000,
    S: { user: { id: me }, board: rows },
    following: () => follow.map(id => ({ user_id: id })),
    nameOf: id => id,
  });
  vm.runInContext(fn("weekBoard") + "; this.out = weekBoard();", ctx);
  return Object.fromEntries(ctx.out.map(x => [x.uid, { rank: x.rank, wins: x.wins, compared: x.compared, played: x.played }]));
}
const r = (user_id, game, day, score, revealed = true) => ({ user_id, game, day, score, revealed });

test("best score on a shared puzzle wins; ties share", () => {
  const b = board({ follow: ["a", "b"], rows: [
    r("me", "wordle", "2026-11-16", 3), r("a", "wordle", "2026-11-16", 4), r("b", "wordle", "2026-11-16", 3),
    r("me", "zip", "2026-11-16", 40), r("a", "zip", "2026-11-16", 18),
  ] });
  assert.equal(b.me.wins, 1); assert.equal(b.b.wins, 1); assert.equal(b.a.wins, 1);
  assert.equal(b.me.compared, 2); assert.equal(b.a.compared, 2);
  assert.equal(b.me.rank, 1); assert.equal(b.a.rank, 1);
});

test("hidden scores and solo puzzles don't count", () => {
  const b = board({ follow: ["a"], rows: [
    r("a", "queens", "2026-11-17", null, false),   // I didn't play it: hidden
    r("me", "tango", "2026-11-17", 90),             // nobody to compare with
  ] });
  assert.equal(b.a.wins, 0); assert.equal(b.a.played, 1);
  assert.equal(b.me.wins, 0); assert.equal(b.me.compared, 0); assert.equal(b.me.played, 1);
});

test("a failed puzzle never wins, even when everyone failed", () => {
  const b = board({ follow: ["a"], rows: [r("me", "wordle", "2026-11-17", 1e9), r("a", "wordle", "2026-11-17", 1e9)] });
  assert.equal(b.me.wins + b.a.wins, 0);
});

test("ranks: more wins first, equal wins share a rank", () => {
  const b = board({ follow: ["a", "b"], rows: [
    r("me", "wordle", "2026-11-16", 3), r("a", "wordle", "2026-11-16", 2),
    r("me", "wordle", "2026-11-17", 4), r("a", "wordle", "2026-11-17", 2),
    r("b", "mini", "2026-11-17", 50), r("me", "mini", "2026-11-17", 60),
  ] });
  assert.deepEqual([b.a.rank, b.b.rank, b.me.rank], [1, 2, 3]);
});

test("Challenge button only for people who follow you", () => {
  const src = app.match(/function personRow\([\s\S]*?\n\}\n/)[0];
  const ctx = vm.createContext({ S: { user: { id: "me" } }, peopleTab: "following", esc: s => s, avatar: () => "" });
  vm.runInContext(src, ctx);
  const row = p => vm.runInContext(`personRow(${JSON.stringify(p)})`, ctx);
  assert.match(row({ user_id: "a", display_name: "A", handle: "a", follows_me: true, i_follow: true }), /data-chwith="a"/);
  assert.doesNotMatch(row({ user_id: "b", display_name: "B", handle: "b", follows_me: false, i_follow: true }), /data-chwith/);
  assert.doesNotMatch(row({ user_id: "me", display_name: "Me", handle: "me", follows_me: true }), /data-chwith/);
});
