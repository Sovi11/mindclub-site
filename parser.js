// Turns a game's share text into a result. Mirrors ios/MindclubKit/ResultParser.swift.
const FAIL = 1000000000;   // a failed puzzle: ranks after every finished one

const GAMES = [
  {id:"wordle", name:"Wordle", sym:"W", color:"#6aaa64", by:"NYT", url:"https://www.nytimes.com/games/wordle/index.html"},
  {id:"connections", name:"Connections", sym:"C", color:"#9a83cf", by:"NYT", url:"https://www.nytimes.com/games/connections"},
  {id:"strands", name:"Strands", sym:"S", color:"#3e8fb0", by:"NYT", url:"https://www.nytimes.com/games/strands"},
  {id:"mini", name:"The Mini", sym:"M", color:"#4a6fd1", by:"NYT", url:"https://www.nytimes.com/crosswords/game/mini"},
  {id:"queens", name:"Queens", sym:"Q", color:"#d98a3a", by:"LinkedIn", url:"https://www.linkedin.com/games/queens"},
  {id:"tango", name:"Tango", sym:"T", color:"#d7684b", by:"LinkedIn", url:"https://www.linkedin.com/games/tango"},
  {id:"zip", name:"Zip", sym:"Z", color:"#b8931f", by:"LinkedIn", url:"https://www.linkedin.com/games/zip"},
  {id:"pips", name:"Pips", sym:"P", color:"#7a5bb5", by:"NYT", url:"https://www.nytimes.com/games/pips"},
  {id:"pinpoint", name:"Pinpoint", sym:"Pp", color:"#2f8a7a", by:"LinkedIn", url:"https://www.linkedin.com/games/pinpoint"},
  {id:"crossclimb", name:"Crossclimb", sym:"Cc", color:"#5a7d3a", by:"LinkedIn", url:"https://www.linkedin.com/games/crossclimb"},
  {id:"minisudoku", name:"Mini Sudoku", sym:"Su", color:"#3d6fa8", by:"LinkedIn", url:"https://www.linkedin.com/games/mini-sudoku"},
  {id:"krillion", name:"Krillion", sym:"K", color:"#1f6f8b", by:"krillion.io", url:"https://krillion.io/"},
  {id:"quordle", name:"Quordle", sym:"Qd", color:"#c4552b", by:"M-W", url:"https://www.merriam-webster.com/games/quordle/"},
  {id:"octordle", name:"Octordle", sym:"Oc", color:"#8f3f71", by:"M-W", url:"https://www.merriam-webster.com/games/octordle/"},
  {id:"waffle", name:"Waffle", sym:"Wf", color:"#c99a2e", by:"wafflegame.net", url:"https://wafflegame.net/"},
  {id:"worldle", name:"Worldle", sym:"Wo", color:"#3a8f6a", by:"teuteuf.fr", url:"https://worldle.teuteuf.fr/"},
  {id:"globle", name:"Globle", sym:"G", color:"#2f6db5", by:"globle-game.com", url:"https://globle-game.com/"},
  {id:"framed", name:"Framed", sym:"F", color:"#5b5b66", by:"framed.wtf", url:"https://framed.wtf/"},
  {id:"nerdle", name:"Nerdle", sym:"N", color:"#7d4fb0", by:"nerdlegame.com", url:"https://www.nerdlegame.com/"},
  {id:"hollowchess", name:"Hollow Chess", sym:"Hc", color:"#1f7a72", by:"hollowchess.com", url:"https://hollowchess.com/#daily"},
];
const G = id => GAMES.find(g => g.id === id);

const SAMPLES = {
  Wordle:"Wordle 1,606 3/6\n\n⬛🟨⬛⬛⬛\n⬛🟩🟩⬛🟨\n🟩🟩🟩🟩🟩",
  Connections:"Connections\nPuzzle #882\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪",
  Strands:"Strands #618\n“Hit the road”\n🔵🔵💡🔵\n🟡🔵🔵",
  Mini:"I solved the 11/12/2026 New York Times Mini Crossword in 0:49!",
  Queens:"Queens #571 | 1:07 👑\nlnkd.in/queens",
  Zip:"Zip #250 | 0:18 🏁",
  Pips:"Pips #1501 Hard 🔴\n2:14",
  Krillion:"Krillion #120 🦐\n430\n\n🦐🐙🐟🦑🐠🐳🦐",
};

function parse(raw){
  const t = (raw||"").trim(); if(!t) return null;
  let m;
  if(m = t.match(/Wordle\s+([\d,. ]+?)\s+([1-6X])\/6/i)){
    const n = m[2].toUpperCase(), ok = n !== "X";
    return {game:"wordle", puzzle:m[1].replace(/\D/g,""), label:n+"/6", score: ok ? +n : FAIL};
  }
  if(/Connections/i.test(t)){
    const rows = t.split("\n").map(r => [...r.matchAll(/🟨|🟩|🟦|🟪/gu)].map(x=>x[0])).filter(r => r.length === 4);
    if(rows.length){
      const correct = rows.filter(r => r.every(c => c === r[0])).length, miss = rows.length - correct;
      const puzzle = (t.match(/#\s*([\d,]+)/)||[])[1]?.replace(/\D/g,"");
      if(correct < 4) return {game:"connections", puzzle, label:"Failed", score:FAIL};
      return {game:"connections", puzzle, label: miss ? `${miss} mistake${miss>1?"s":""}` : "Perfect", score:miss};
    }
  }
  if(m = t.match(/Strands\s+#?\s*([\d,]+)/i)){
    const h = [...t.matchAll(/💡/gu)].length;
    return {game:"strands", puzzle:m[1].replace(/\D/g,""), label: h ? `${h} hint${h>1?"s":""}` : "No hints", score:h};
  }
  if(m = t.match(/Mini Crossword in (\d+):(\d{2})/i)) return {game:"mini", label:`${m[1]}:${m[2]}`, score:+m[1]*60 + +m[2]};
  // Pips has three levels a day. A harder level ranks above an easier one, then the faster time wins.
  if(m = t.match(/Pips\s*#\s*(\d+)\s+(Easy|Medium|Hard)[^\n]*\n\s*(?:(\d+):)?(\d{1,2}):(\d{2})/i)){
    const level = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase(), secs = (+m[3]||0)*3600 + +m[4]*60 + +m[5];
    return {game:"pips", puzzle:m[1], label:`${level} ${m[3] ? m[3]+":"+m[4].padStart(2,"0") : m[4]}:${m[5]}`,
            score:{Hard:0, Medium:1, Easy:2}[level]*100000 + secs};
  }
  // Krillion: points, higher is better, so the score is stored negative (lower always ranks first).
  // "Krillion #120" is the daily dive; archive (⟲) and unlimited (∞) shares are left out on purpose.
  if(m = t.match(/Krillion #(\d+)[^\n]*\n\s*(\d+)/)) return {game:"krillion", puzzle:m[1], label:`${m[2]} pts`, score:-m[2]};
  if(m = t.match(/Pinpoint\s*#?\s*(\d+)[^\n]{0,30}?(\d)\s*guess/i)) return {game:"pinpoint", puzzle:m[1], label:`${m[2]} guess${m[2]>1?"es":""}`, score:+m[2]};
  // Formats below checked against real shares and the games' own code on 18 Nov 2026.
  // Quordle: four keycap digits (guesses per word), 🟥 for a missed word. Sequence, Chill, Extreme,
  // Rescue, Weekly and practice modes have other headers and are left out.
  if(m = t.match(/(?:^|\s)Daily Quordle (\d+)\s*\n([^\n]*)\n([^\n]*)/)){
    const cells = [...(m[2] + m[3]).matchAll(/([1-9])️?⃣|🟥/gu)].map(x => x[1] ? +x[1] : null);
    if(cells.length === 4){
      const label = cells.map(c => c ?? "✗").join("·");
      return {game:"quordle", puzzle:m[1], label, score: cells.includes(null) ? FAIL : cells.reduce((a,b) => a+b, 0)};
    }
  }
  // Octordle: "Score: N" is the total guesses over eight words; any 🟥 means a word was missed.
  if(m = t.match(/(?:^|\s)Daily Octordle #(\d+)\s*\n([\s\S]*?)Score:\s*(\d+)/)){
    return /🟥/u.test(m[2]) ? {game:"octordle", puzzle:m[1], label:"Failed", score:FAIL}
                           : {game:"octordle", puzzle:m[1], label:`Score ${m[3]}`, score:+m[3]};
  }
  // Waffle: stars left (0-5), higher is better, so stored negative. "#deluxewaffle" is left out.
  if(m = t.match(/(?:^|\s)#waffle(\d+)\s+([0-5X])\/5/i)){
    return m[2].toUpperCase() === "X" ? {game:"waffle", puzzle:m[1], label:"Failed", score:FAIL}
                                      : {game:"waffle", puzzle:m[1], label:`${m[2]}/5 ★`, score:0 - m[2]};
  }
  if(m = t.match(/Worldle\s+#(\d+)\s*\(\d{2}\.\d{2}\.\d{4}\)\s+([1-6X])\/6/i)){
    const n = m[2].toUpperCase();
    return {game:"worldle", puzzle:m[1], label:n+"/6", score: n === "X" ? FAIL : +n};
  }
  // Globle has no puzzle number; the share carries the player's local date. "-- = --" is an unfinished day.
  if(m = t.match(/🌎\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s*🌍[\s\S]*?=\s*(\d+)/u)){
    const mon = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1]) / 3;
    if(mon >= 0 && Number.isInteger(mon)){
      const date = `${m[3]}-${String(mon+1).padStart(2,"0")}-${m[2].padStart(2,"0")}`;
      return {game:"globle", date, label:`${m[4]} guess${m[4] === "1" ? "" : "es"}`, score:+m[4]};
    }
  }
  // Framed: which of six frames you got it on. One Frame, Title Shot and Poster modes say "Framed - ...".
  if(m = t.match(/(?:^|\s)#?Framed #(\d+)\s*\n\s*🎥([^\n]*)/u)){
    const at = [...m[2].matchAll(/🟥|🟩|⬛/gu)].findIndex(x => x[0] === "🟩");
    return at < 0 ? {game:"framed", puzzle:m[1], label:"Failed", score:FAIL}
                  : {game:"framed", puzzle:m[1], label:`${at+1}/6`, score:at+1};
  }
  // Hollow Chess daily puzzle (hollowchess.com, js/main.js shareDaily). Only solved shares count; a first-try
  // solve ranks above one that took retries, then the faster time wins. Minutes can run past 59.
  if(m = t.match(/Hollow Chess Daily #(\d+): solved (first try )?in (\d+):(\d{2})/i)){
    const clean = !!m[2], secs = +m[3]*60 + +m[4];
    return {game:"hollowchess", puzzle:m[1], label:`${m[3]}:${m[4]}${clean ? " · first try" : ""}`, score:(clean ? 0 : 100000) + secs};
  }
  // Nerdle classic only: mini, micro, speed, binerdle and Instant shares start differently.
  if(m = t.match(/(?:^|\n)\s*nerdlegame (\d+) ([1-6X])\/6/i)){
    const n = m[2].toUpperCase();
    return {game:"nerdle", puzzle:m[1], label:n+"/6", score: n === "X" ? FAIL : +n};
  }
  for(const [id,name] of [["queens","Queens"],["tango","Tango"],["zip","Zip"],["crossclimb","Crossclimb"],["minisudoku","Mini Sudoku"]]){
    const re = new RegExp(name + "\\s*#?\\s*(\\d+)\\D{0,12}?(\\d{1,2}):(\\d{2})", "i");
    if(m = t.match(re)) return {game:id, puzzle:m[1], label:`${m[2]}:${m[3]}`, score:+m[2]*60 + +m[3]};
  }
  return null;
}

// Daily puzzle numbers tell us which day a result belongs to.
// Checked against the live sites on 12 Nov 2026: Wordle #1972, Connections #1250, Krillion #120.
// Added 18 Nov 2026, each from 2-3 dated real shares that agree: Quordle/Octordle #1426 = 2025-12-20,
// Waffle #1762 = 2026-11-18, Worldle #1762 = 2026-11-18, Framed #1713 = 2026-11-18, Nerdle #1764 = 2026-11-18.
const EPOCH = { wordle: "2021-06-19", connections: "2023-06-11", strands: "2024-03-03", krillion: "2026-07-15",
  quordle: "2022-01-24", octordle: "2022-01-24", waffle: "2022-01-21", worldle: "2022-01-21",
  framed: "2022-03-11", nerdle: "2022-01-19",
  hollowchess: "2026-11-20" };   // Hollow Chess: Daily #1 = 21 Nov 2026 (DAILY_EPOCH in its main.js), new one at 00:00 UTC
function puzzleDate(p){
  if(p.date) return new Date(p.date + "T12:00");   // Globle: the share says which day it was
  const start = EPOCH[p.game];
  if(!start || !p.puzzle) return null;
  const d = new Date(start + "T12:00");
  d.setDate(d.getDate() + Number(p.puzzle));
  return d;
}
