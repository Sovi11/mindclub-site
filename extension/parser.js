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
  for(const [id,name] of [["queens","Queens"],["tango","Tango"],["zip","Zip"],["crossclimb","Crossclimb"],["minisudoku","Mini Sudoku"]]){
    const re = new RegExp(name + "\\s*#?\\s*(\\d+)\\D{0,12}?(\\d{1,2}):(\\d{2})", "i");
    if(m = t.match(re)) return {game:id, puzzle:m[1], label:`${m[2]}:${m[3]}`, score:+m[2]*60 + +m[3]};
  }
  return null;
}

// Daily puzzle numbers tell us which day a result belongs to.
// Checked against the live sites on 12 Nov 2026: Wordle #1972, Connections #1250, Krillion #120.
const EPOCH = { wordle: "2021-06-19", connections: "2023-06-11", strands: "2024-03-03", krillion: "2026-07-15" };
function puzzleDate(p){
  const start = EPOCH[p.game];
  if(!start || !p.puzzle) return null;
  const d = new Date(start + "T12:00");
  d.setDate(d.getDate() + Number(p.puzzle));
  return d;
}
