// node --test tests/*.test.mjs
// Share texts below are real ones people posted (Mastodon / Lemmy, 2025-2026), or built from the
// game's own share code where noted. They pin the parser and the puzzle-number calendars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL("../parser.js", import.meta.url), "utf8") + "; this.P = { GAMES, SAMPLES, FAIL, parse, puzzleDate };", ctx);
const { GAMES, SAMPLES, FAIL, parse, puzzleDate } = ctx.P;
const p = t => { const r = parse(t); return r && { game: r.game, label: r.label, score: r.score, puzzle: r.puzzle ?? null, date: r.date ?? null }; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = t => ymd(puzzleDate(parse(t)));

test("every game has a unique id, symbol and a parser-friendly id", () => {
  assert.equal(new Set(GAMES.map(g => g.id)).size, GAMES.length);
  assert.equal(new Set(GAMES.map(g => g.sym)).size, GAMES.length);
  for (const g of GAMES) assert.match(g.id, /^[a-z]{2,20}$/, "results.game check constraint");
});

test("existing samples still parse to their own game", () => {
  for (const [name, text] of Object.entries(SAMPLES)) assert.ok(parse(text), name);
});

test("Quordle", () => {
  assert.deepEqual(p("🙂 Daily Quordle 1758\n3️⃣6️⃣\n7️⃣5️⃣\nm-w.com/games/quordle/"),
    { game: "quordle", label: "3·6·7·5", score: 21, puzzle: "1758", date: null });
  assert.deepEqual(p("🙂 Daily Quordle 1394\n8️⃣6️⃣\n4️⃣🟥\nm-w.com/games/quordle/\n⬜⬜⬜"),
    { game: "quordle", label: "8·6·4·✗", score: FAIL, puzzle: "1394", date: null });
  assert.equal(parse("Daily Sequence Quordle 1758\n3️⃣6️⃣\n7️⃣🔟"), null);
  assert.equal(parse("🥵 Daily Extreme 300\n3️⃣6️⃣\n7️⃣5️⃣"), null);
  assert.equal(dateOf("🙂 Daily Quordle 1426\n4️⃣7️⃣\n3️⃣6️⃣\nm-w.com/games/quordle/"), "2025-12-20");
  assert.equal(dateOf("🙂 Daily Quordle 1758\n3️⃣6️⃣\n7️⃣5️⃣"), "2026-11-17");
});

test("Octordle", () => {
  assert.deepEqual(p("Daily Octordle #1426\n🔟3️⃣\n9️⃣6️⃣\n8️⃣2️⃣\n7️⃣4️⃣\nScore: 49"),
    { game: "octordle", label: "Score 49", score: 49, puzzle: "1426", date: null });
  assert.equal(p("Daily Octordle #1619\n7️⃣8️⃣\n6️⃣🟥\n9️⃣🕚\n5️⃣🔟\nScore: 68").score, FAIL);   // built from the game's code
  assert.equal(parse("Daily Sequence Octordle #1426\n🔟3️⃣\nScore: 70"), null);
  assert.equal(dateOf("Daily Octordle #1692\n…\nScore: 60"), "2026-09-12");
});

test("Waffle", () => {
  const ok = "#waffle1762 5/5\n\n🟩🟩🟩🟩🟩\n🟩⭐🟩⭐🟩\n🟩🟩⭐🟩🟩\n🟩⭐🟩⭐🟩\n🟩🟩🟩🟩🟩\n\n🔥 streak: 536\n👑 #waffleroyalty\nwafflegame.net";
  assert.deepEqual(p(ok), { game: "waffle", label: "5/5 ★", score: -5, puzzle: "1762", date: null });
  assert.equal(p("#waffle1761 0/5\n\n🟩\n\n🔥 streak: 1\nwafflegame.net").score, 0);
  assert.equal(p("#waffle1694 X/5\n\n🟩⬛🟩⬛🟩\n\n💔 streak: 0\nwafflegame.net").score, FAIL);
  assert.equal(parse("#deluxewaffle232 1/5\n\nwafflegame.net/deluxe"), null);
  assert.equal(dateOf(ok), "2026-11-18");
  assert.equal(dateOf("#waffle1692 3/5"), "2026-09-09");
});

test("Worldle", () => {
  const ok = "#Worldle #1762 (18.11.2026) 1/6 (100%)\n🔥 Current Win Streak: 3 days\n🟩🟩🟩🟩🟩🎉\nhttps://worldle.teuteuf.fr/share";
  assert.deepEqual(p(ok), { game: "worldle", label: "1/6", score: 1, puzzle: "1762", date: null });
  assert.equal(p("#Worldle #1761 (17.11.2026) X/6 (93%)\n🔥 Current Win Streak: 0 days").score, FAIL);
  assert.equal(p("#Worldle #1760 (16.11.2026) 4/6 (100%)\n🔥 Aktuelle Siegesserie: 2 Tage").score, 4);
  assert.equal(parse("Wordle 1,606 3/6").game, "wordle");   // not confused with Worldle
  assert.equal(dateOf(ok), "2026-11-18");
  assert.equal(dateOf("#Worldle #1706 (23.09.2026) 2/6 (100%)"), "2026-09-23");
});

test("Globle", () => {
  const ok = "🌎 Nov 18, 2026 🌍\n🔥 50 | Avg. Guesses: 5.82\n⬜🟧🟥🟥🟩 = 5\n\nhttps://globle-game.com\n#globle";
  assert.deepEqual(p(ok), { game: "globle", label: "5 guesses", score: 5, puzzle: null, date: "2026-11-18" });
  assert.equal(p("🌎 Nov 14, 2026 🌍\n🔥 1 | Avg. Guesses: 20\n🟨🟨🟧🟧🟨🟥🟧🟧\n🟧🟧🟧🟥🟧🟥🟥🟥\n🟥🟥🟥🟩 = 20\n\nhttps://globle-game.com/\n#globle").score, 20);
  assert.equal(p("🌎 Mar 3, 2026 🌍\n🔥 2 | Avg. Guesses: 3\n🟩 = 1\n#globle").label, "1 guess");
  assert.equal(parse("🌎 Nov 18, 2026 🌍\n🔥 0 | Avg. Guesses: 0\n-- = --\n#globle"), null);   // from the game's code
  assert.equal(dateOf(ok), "2026-11-18");
});

test("Framed", () => {
  assert.deepEqual(p("Framed #1713\n🎥 🟥 🟥 🟥 🟥 🟩 ⬛\n\nhttps://framed.wtf"),
    { game: "framed", label: "5/6", score: 5, puzzle: "1713", date: null });
  assert.equal(p("#Framed #1713\n🎥 🟥 🟥 🟥 🟥 🟩 ⬛\n\nhttps://framed.wtf").score, 5);
  assert.equal(p("Framed #1099\n🎥 🟥 🟥 🟥 🟥 🟥 🟥\n\nhttps://framed.wtf").score, FAIL);
  assert.equal(parse("Framed - One Frame Challenge #500\n🎥 🟩\n\nhttps://framed.wtf/one-frame"), null);
  assert.equal(parse("Framed - Poster Challenge #200\n🎥 🟥 🟩\n\nhttps://framed.wtf/poster"), null);
  assert.equal(dateOf("Framed #1713\n🎥 🟩"), "2026-11-18");
  assert.equal(dateOf("Framed #1099\n🎥 🟩"), "2025-03-14");
  assert.equal(dateOf("Framed #742\n🎥 🟩"), "2024-03-22");
});

test("Nerdle", () => {
  const ok = "nerdlegame 1764 4/6\n\n⬛⬛⬛⬛🟩🟩🟪🟪\n🟪🟪🟩🟩🟩🟩🟪⬛\n🟩🟪🟩🟩🟩🟩🟩⬛\n🟩🟩🟩🟩🟩🟩🟩🟩";
  assert.deepEqual(p(ok), { game: "nerdle", label: "4/6", score: 4, puzzle: "1764", date: null });
  assert.equal(p("nerdlegame 1762 X/6\n\n⬛").score, FAIL);   // assumed format, no real lost share found
  for (const v of ["mini nerdlegame 1764 3/6", "micro nerdlegame 1764 2/6", "speed nerdlegame 1764 solved in 1m 2s!", "binerdle 300 3&5/7"])
    assert.equal(parse(v), null, v);
  assert.equal(dateOf(ok), "2026-11-18");
  assert.equal(dateOf("nerdlegame 1425 3/6"), "2025-12-14");
  assert.equal(dateOf("nerdlegame 1627 3/6"), "2026-07-04");
});
