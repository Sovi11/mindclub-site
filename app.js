/* Mindclub web app: accounts, follows, challenges and results backed by Supabase. */
const sb = supabase.createClient(MINDCLUB_CONFIG.supabaseUrl, MINDCLUB_CONFIG.supabaseKey);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PALETTE = ["#e2552d","#3e8fb0","#8a5cc2","#2f7d4f","#c2417a","#d98a3a"];
const colorFor = id => PALETTE[[...String(id)].reduce((a,c)=>a+c.charCodeAt(0),0) % PALETTE.length];
const dayKey = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const mondayOf = d => addDays(d, -((d.getDay()+6)%7));
const daysAgo = key => Math.round((new Date(dayKey() + "T12:00") - new Date(key + "T12:00")) / 864e5);
const prettyDay = key => new Date(key + "T12:00").toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" });
// Which day a result belongs to: from its puzzle number when we know the game's calendar, else today.
function resultDay(p){
  const d = puzzleDate(p);
  if(!d) return dayKey();
  const key = dayKey(d);
  return daysAgo(key) < 0 ? dayKey() : key;   // a "tomorrow" puzzle is a timezone edge: count it today
}
const MAX_BACKFILL = 7;
// One sample result per game, used for the demo friend.
const DEMO = Object.fromEntries(Object.values(SAMPLES).map(parse).filter(Boolean).map(p => [p.game, p]));
DEMO.wordle = { ...DEMO.wordle, label: "4/6", score: 4 };
// Phones and tablets: no keyboard shortcuts, and auto-log (clipboard on focus) doesn't work there.
const TOUCH = matchMedia("(pointer: coarse)").matches;
const KEYV = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘V" : "Ctrl+V";
// The extension installs from the Chrome Web Store in Chrome and Chromium browsers (Brave, Edge, Arc) on desktop.
const EXT_URL = "https://chromewebstore.google.com/detail/mindclub/mbjkoedlkpmpnnkhfnbdiopgcekjojam";
const CAN_EXT = !TOUCH && /Chrome\//.test(navigator.userAgent);
const local = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } },
  set(k,v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
};

/* ================= state ================= */
const S = {
  user: null, profile: null,
  people: [],      // my_people(): everyone I follow or who follows me
  mine: [],        // my results, last ~20 weeks
  board: [],       // following_board rows, Monday..today
  challenges: [],  // my_challenges(), last 2 weeks
};
const openRows = new Set();   // Today rows the user expanded
const todays = id => S.mine.find(r => r.game === id && r.day === dayKey());
const loggedOn = (id, day) => S.mine.find(r => r.game === id && r.day === day);
const following = () => S.people.filter(p => p.i_follow);
const followers = () => S.people.filter(p => p.follows_me);
// The games you chose to show on Today (all of them until you pick).
const shownGames = () => S.profile?.games ? GAMES.filter(g => S.profile.games.includes(g.id)) : GAMES;
const iconHtml = (g, cls = "") => `<div class="gicon ${g.sym.length > 1 ? "two" : ""} ${cls}" style="background:${g.color}">${g.sym}</div>`;
const nameOf = uid => uid === S.user?.id ? "You"
  : (S.people.find(m => m.user_id === uid)?.display_name || S.challenges.find(c => c.other_id === uid)?.other_name || "Someone");
const cleanHandle = h => String(h || "").trim().toLowerCase().replace(/^@/, "");
const autoHandle = h => /^player\d*$/.test(h || "");
const profileUrl = () => `${location.origin}${location.pathname}?u=${S.profile?.handle || ""}`;

/* ================= auth ================= */
const isGuest = () => !!S.user?.is_anonymous;
const isUnnamed = () => S.profile.display_name === (S.user.email || "").split("@")[0] || (isGuest() && S.profile.display_name === "Guest");

// Guests are real (anonymous) accounts, so follows and challenges work the same.
async function signInGuest(){
  const btn = $("guestBtn");
  btn.disabled = true; btn.textContent = "Starting...";
  const { error } = await sb.auth.signInAnonymously();
  btn.disabled = false; btn.textContent = "Try it now";
  if(error){
    $("guestNotice").hidden = false;
    $("guestNotice").textContent = /disabled/i.test(error.message) ? "Guest sign-in is turned off right now. Use your email instead."
      : /rate|many/i.test(error.message) ? "Too many guest sign-ins from this network. Try again later, or use your email."
      : error.message;
  }
}
// Turning a guest into a normal account: Supabase emails a link; once it's clicked, the guest keeps everything.
$("keepForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("keepEmail").value.trim(), btn = e.submitter || $("keepForm").querySelector("button");
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
  btn.disabled = false;
  $("keepErr").hidden = !error;
  if(error){
    $("keepErr").textContent = /already|registered|exists/i.test(error.message)
      ? "That email already has a Mindclub account. Sign out and sign in with it instead." : error.message;
    return;
  }
  $("keepForm").hidden = true;
  $("guestHint").textContent = `We sent a link to ${email}. Click it in this browser and your guest account becomes a normal one, with everything kept.`;
};
// A profile link (?u=handle) is remembered across the email sign-in round trip.
const urlFollow = new URLSearchParams(location.search).get("u");
if(urlFollow){
  const g = new URLSearchParams(location.search).get("g");
  local.set("mc-follow", cleanHandle(urlFollow));
  local.set("mc-follow-game", G(g) ? g : null);
  history.replaceState(null, "", location.pathname);
}
if(new URLSearchParams(location.search).get("connect") === "extension"){
  local.set("mc-connect-ext", true); history.replaceState(null, "", location.pathname);
}


$("authForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  $("authBtn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin + location.pathname } });
  $("authBtn").disabled = false;
  if(error){
    $("authNotice").hidden = false;
    $("authNotice").textContent = /rate|seconds/i.test(error.message)
      ? "Too many sign-in emails in a short time. Wait a few minutes and try again."
      : error.message;
    return;
  }
  $("authNotice").hidden = true;
  $("sentTo").textContent = email;
  $("authAsk").hidden = true; $("authSent").hidden = false;
};

// A link that failed (expired, already used) comes back with an error in the URL.
const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description")
             || new URLSearchParams(location.search).get("error_description");
if(hashErr){
  $("authNotice").hidden = false;
  $("authNotice").textContent = /expired|invalid/i.test(hashErr)
    ? "That sign-in link has expired or was already used. Enter your email to get a new one."
    : hashErr;
  history.replaceState(null, "", location.pathname);
}

sb.auth.onAuthStateChange((_event, session) => {
  const u = session?.user || null;
  if(u && u.id === S.user?.id){ S.user = u; if(S.profile) render(); return; }   // same person, e.g. a guest who just added their email
  S.user = u;
  // Defer: calling Supabase inside this callback can deadlock the auth client.
  setTimeout(() => u ? boot() : showAuth(), 0);
});

function showAuth(){
  $("appScreen").hidden = true; $("authScreen").hidden = false;
  const h = local.get("mc-follow"), g = G(local.get("mc-follow-game"));
  $("joinBadge").hidden = !h;
  $("heroInvite").hidden = !h;
  if(h) $("heroInvite").textContent = g ? `@${h} wants you to beat their ${g.name} today. Tap Try it now to take them on.`
                                        : `@${h} sent you their link. Tap Try it now, then follow them in one tap.`;
}

async function boot(){
  $("authScreen").hidden = true; $("appScreen").hidden = false;
  await loadAll();
  const h = local.get("mc-follow"), hg = local.get("mc-follow-game");
  if(h && S.profile){ local.set("mc-follow", null); local.set("mc-follow-game", null); if(h !== S.profile.handle) showInvited(h, hg); }
  if(local.get("mc-connect-ext")){ local.set("mc-connect-ext", null); setTimeout(connectExtension, 300); }
  else if(!local.get(TOUR_KEY) && S.profile) setTimeout(() => { if(!modalOpen()) openTour(0); }, 400);
}

/* ================= data ================= */
let loadSeq = 0;
async function loadAll(){
  const since = dayKey(addDays(new Date(), -140));
  const [p, r, pe] = await Promise.all([
    sb.from("profiles").select("id, display_name, handle, games").eq("id", S.user.id).single(),
    sb.from("results").select("game, day, label, score, puzzle, stars, created_at").eq("user_id", S.user.id).gte("day", since),
    sb.rpc("my_people"),
  ]);
  if(p.error || r.error || pe.error){
    $("loadErr").hidden = false;
    return;
  }
  $("loadErr").hidden = true;
  S.profile = p.data; S.mine = r.data; S.people = pe.data || [];
  await loadSocial();
}

async function loadPeople(){
  const { data, error } = await sb.rpc("my_people");
  if(!error){ S.people = data || []; render(); }
}

// Friends' results and challenges. Called after anything that can reveal a score.
async function loadSocial(){
  if(!S.user) return;
  const seq = ++loadSeq;
  const [b, ch] = await Promise.all([
    sb.rpc("following_board", { p_from: dayKey(mondayOf(new Date())), p_to: dayKey() }),
    sb.rpc("my_challenges"),
  ]);
  if(seq !== loadSeq) return;   // a newer request has started
  if(!b.error) S.board = b.data || [];
  if(!ch.error) S.challenges = ch.data || [];
  render();
}


async function saveResult(r, day = dayKey()){
  const row = { user_id: S.user.id, game: r.game, day, label: r.label, score: r.score ?? null,
                puzzle: r.puzzle || null, stars: r.stars || null, updated_at: new Date().toISOString() };
  const { error } = await sb.from("results").upsert(row, { onConflict: "user_id,game,day" });
  if(error){ toast("Couldn't save: " + error.message); return false; }
  S.mine = S.mine.filter(x => !(x.game === row.game && x.day === row.day)).concat({ ...row, created_at: new Date().toISOString() });
  if(local.get("mc-pending")?.game === r.game) local.set("mc-pending", null);
  await loadSocial();   // reveals friends' scores for this game
  return true;
}

function streak(){
  const days = new Set(S.mine.map(r => r.day));
  let d = new Date(); if(!days.has(dayKey(d))) d = addDays(d,-1);
  let n = 0; while(days.has(dayKey(d))){ n++; d = addDays(d,-1); }
  return n;
}

/* ================= render ================= */
function avatar(uid, label){
  const me = uid === S.user.id;
  return `<div class="av" style="background:${me ? "var(--ink)" : colorFor(uid)};${me ? "color:var(--bg)" : ""}">${esc(((me ? S.profile?.display_name : label) || "?")[0].toUpperCase())}</div>`;
}

function render(){
  if(!S.user || !S.profile) return;
  const now = new Date(), h = now.getHours();
  const first = S.profile.display_name.split(" ")[0];
  const unnamed = isUnnamed();
  $("guestBar").hidden = !isGuest();
  $("hello").textContent = `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}${unnamed ? "" : ", " + first}`;
  const shown = shownGames();
  const onToday = GAMES.filter(g => shown.includes(g) || todays(g.id));
  const done = onToday.filter(g => todays(g.id)).length;
  $("todaySub").textContent = `${now.toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})} · ${done} of ${onToday.length} played`;
  $("gridFoot").innerHTML = `${shown.length < GAMES.length ? `Showing ${shown.length} of ${GAMES.length} games. ` : ""}<button class="linkbtn" data-view="games">Choose games</button> or <button class="linkbtn" data-view="games">suggest one we're missing</button>`;

  // First-run welcome: shown once. It goes away when your name and handle are set (unless you just set
  // them here, so step 2 stays in view), when you have anyone to follow or be followed by, or when you hide it.
  const fing = following(), fers = followers();
  const setUp = !unnamed && !autoHandle(S.profile.handle);
  $("welcome").hidden = S.people.length > 0 || !!local.get(WELCOME_KEY) || (setUp && !justNamed);
  $("wName").classList.toggle("done", !unnamed && !autoHandle(S.profile.handle));
  if(document.activeElement !== $("nameInput")) $("nameInput").value = unnamed ? "" : S.profile.display_name;
  if(document.activeElement !== $("handleInput")) $("handleInput").value = autoHandle(S.profile.handle) ? "" : S.profile.handle;

  $("meName").textContent = S.profile.display_name;
  $("meHandle").textContent = "@" + S.profile.handle;
  $("meAv").outerHTML = `<div class="av" id="meAv" style="background:var(--ink);color:var(--bg)">${esc(S.profile.display_name[0].toUpperCase())}</div>`;
  document.querySelectorAll(".profileLink").forEach(el => el.textContent = profileUrl());

  const pending = local.get("mc-pending");
  const p = pending && !todays(pending.game) && Date.now() - pending.at < 6*3600e3 && G(pending.game) ? pending : null;
  $("backBanner").classList.toggle("show", !!p);
  if(p) $("backTitle").textContent = `Back from ${G(p.game).name}?`;
  $("backHint").textContent = extState() === "connected"
    ? "Tap Share in the game. The extension logs it."
    : autoOn() ? "Tap Share in the game. It logs itself when you come back to this tab."
    : TOUCH ? "Tap Share in the game, then tap Paste here." : `Tap Share in the game, then press ${KEYV} here.`;
  renderAuto();

  const today = dayKey();
  // Demo friend: shown to people who follow nobody yet, on one game, so they can see the spoiler rule work.
  // It only exists in this page. Nothing is saved and nobody else sees it.
  const demo = !fing.length && !local.get("mc-demo-off")
    ? (onToday.find(g => g.id === "wordle" && DEMO[g.id]) || onToday.find(g => DEMO[g.id]))?.id : null;
  // Search looks through every game, not just the ones picked for Today.
  const q = ($("gameSearch").value || "").trim().toLowerCase();
  const pool = q ? GAMES.filter(g => (g.name + " " + g.by + " " + g.id).toLowerCase().includes(q)) : onToday;
  const ordered = [...pool].sort((a,b) => !!todays(a.id) - !!todays(b.id));
  const chev = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  $("games").innerHTML = ordered.length ? ordered.map(g => {
    const mine = todays(g.id);
    const rows = S.board.filter(r => r.day === today && r.game === g.id && r.user_id !== S.user.id)
      .map(r => ({ uid: r.user_id, name: nameOf(r.user_id), label: r.revealed ? r.label : "hidden", score: r.score }));
    if(g.id === demo) rows.push({ uid: "demo", name: "Demo friend", demo: true,
      label: mine ? DEMO[g.id].label : "hidden", score: mine ? DEMO[g.id].score : null });
    let people = rows;
    if(mine){
      people = rows.concat({ uid: S.user.id, name: "You", me: true, label: mine.label, score: mine.score });
      people.sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity));
    }
    const scores = people.map(x => x.score).filter(s => s != null && s < FAIL);
    const best = scores.length ? Math.min(...scores) : null;
    const friendsLine = fing.length ? `${rows.filter(x => !x.demo).length} of ${fing.length} you follow played` : g.id === demo ? "Showing a demo friend" : "Follow friends to compare";
    const list = people.length
      ? people.map(x => `<div class="p ${x.me ? "me" : ""} ${mine && x.score === best && best != null ? "best" : ""}">
          ${mine ? `<span class="rank">${rankOf(x, people)}</span>` : ""}${avatar(x.uid, x.name)}${esc(x.name)}${x.demo ? `<span class="demotag">demo</span>` : ""}<span class="res">${esc(x.label)}</span></div>`).join("")
      : `<div class="nofriends">${fing.length ? "Nobody you follow has played yet." : "Your result shows here once you log it."}</div>`;
    const dared = S.challenges.filter(c => !c.outgoing && c.game === g.id && c.day === today && c.status === "open");
    const daredLine = dared.length && !mine
      ? `<div class="chbadge">${esc(dared.slice(0,2).map(c => c.other_name).join(" and "))}${dared.length > 2 ? ` and ${dared.length - 2} more` : ""} challenged you</div>` : "";
    // Collapsed row: your rank once you've played, otherwise who has played (scores stay hidden).
    const meRow = people.find(x => x.me);
    const rk = mine && people.length > 1 && meRow && meRow.score != null ? rankOf(meRow, people) : "";
    const meta = rk ? `<span class="rkc ${rk === 1 ? "first" : ""}">#${rk} of ${people.length}</span>`
      : !mine && rows.length ? `<span class="avs">${rows.slice(0,3).map(x => avatar(x.uid, x.name)).join("")}</span><span class="cnt">${rows.length} played</span>` : "";
    const open = openRows.has(g.id);
    return `<article class="grow ${mine ? "done" : ""} ${open ? "open" : ""}">
      <div class="ghd" data-toggle="${g.id}" role="button" tabindex="0" aria-expanded="${open}">
        ${iconHtml(g)}
        <div class="gtxt"><div class="gname">${g.name}</div><div class="gsub">${esc(g.by)} · ${friendsLine}</div></div>
        <div class="gmeta">${meta}</div>
        ${mine ? `<span class="mine">${esc(mine.label)}</span>`
          : `<a class="btn play" href="${g.url}" target="_blank" rel="noopener" data-play="${g.id}">Play</a>`}
        ${chev}
      </div>
      ${daredLine}
      <div class="gbody">
        <div class="people ${mine ? "" : "locked"}">
          ${list}
          ${!mine && rows.length ? `<div class="lock">${g.id === demo
            ? "Log your " + esc(g.name) + " to see their score. Friends' scores stay hidden until you've played the same puzzle, so nobody spoils it for you."
            : "Log yours to see their scores."}</div>` : ""}
          ${mine && g.id === demo ? `<div class="demonote">That's how it works with real friends: their score shows once you've played too.
            <span><button class="linkbtn" data-view="people">Find friends</button> · <button class="linkbtn" data-act="copylink">Copy your link</button> · <button class="linkbtn" data-act="hidedemo">Hide demo</button></span></div>` : ""}
        </div>
        ${mine ? `<div class="cardfoot quiet"><button class="linkbtn strong" data-share="${g.id}">Share</button><button class="linkbtn" data-challenge="${g.id}">Challenge followers</button><button class="linkbtn" data-act="log">Change</button><button class="linkbtn" data-remove="${g.id}|${today}">Remove</button></div>`
               : `<div class="cardfoot"><button class="btn ghost" data-act="log">Paste result</button><button class="btn ghost" data-played="${g.id}">I played, no score</button></div>`}
      </div>
    </article>`;
  }).join("") : `<div class="nomatch">No game called "${esc(q)}" yet.<button class="linkbtn" data-view="games">Suggest it</button></div>`;
  $("gridFoot").hidden = !!q;

  // streak + week
  const s = streak();
  $("streakN").textContent = s; $("streakLbl").textContent = s === 1 ? "day" : "days";
  const monday = mondayOf(now);
  $("week").innerHTML = [...Array(7)].map((_,i) => {
    const d = addDays(monday,i), k = dayKey(d), n = S.mine.filter(r => r.day === k).length;
    return `<div class="wd"><div class="dot ${n ? "full" : ""} ${k === today ? "today" : ""}">${n || ""}</div>${d.toLocaleDateString(undefined,{weekday:"narrow"})}</div>`;
  }).join("");

  // rail
  const lb = weekBoard();
  const max = Math.max(...lb.map(x => x.wins), 1);
  $("lb").innerHTML = lb.map(x => `<div class="row ${x.uid === S.user.id ? "me" : ""}" title="${x.wins} win${x.wins === 1 ? "" : "s"} from ${x.compared} puzzle${x.compared === 1 ? "" : "s"} compared · ${x.played} played this week">
    <span class="rk">${x.rank}</span>${avatar(x.uid, x.n)}
    <span class="nm">${esc(x.n)}</span><div class="bar"><i style="width:${x.wins/max*100}%"></i></div><span class="n">${x.wins}</span><span class="pl">${x.played}</span></div>`).join("")
    + (fing.length ? `<div class="lbnote">A win is the best score on a puzzle you also played. Ties share it.</div>`
                   : `<div class="nofriends" style="margin-top:4px">Follow friends to see who's winning this week.</div>`);


  renderInvite();
  renderStreak(s);
  renderChallenges();
  renderPeople();
  renderBoard();
  renderHistory();
  renderPicker();
}

/* ================= weekly leaderboard =================
   You and the people you follow, Monday to today. For every game and day where at least two of you
   have a comparable score, the best score wins (ties share the win). Friends' scores are only revealed
   on puzzles you played too, so the board only counts those: no spoilers. */
function weekBoard(rows = S.board){
  const ids = [S.user.id, ...following().map(p => p.user_id)];
  const st = new Map(ids.map(id => [id, { uid: id, n: nameOf(id), wins: 0, compared: 0, played: 0 }]));
  const groups = {};
  for(const r of rows){
    const s = st.get(r.user_id); if(!s) continue;
    s.played++;
    if(r.revealed && r.score != null) (groups[r.game + "|" + r.day] ||= []).push(r);
  }
  for(const rows of Object.values(groups)){
    if(rows.length < 2) continue;
    const best = Math.min(...rows.map(r => r.score));
    for(const r of rows){
      const s = st.get(r.user_id); s.compared++;
      if(r.score === best && best < FAIL) s.wins++;
    }
  }
  const list = [...st.values()].sort((a,b) => b.wins - a.wins || b.played - a.played || (a.uid === S.user.id ? -1 : 1));
  list.forEach((x, i) => x.rank = i && x.wins === list[i-1].wins ? list[i-1].rank : i + 1);
  return list;
}

/* ================= leaderboard page =================
   Friends: weekBoard() over this week or the last 30 days. Everyone: global_board(), which ranks every
   email account by points (10 x the share of players beaten on each puzzle) and never returns a score. */
const WELCOME_KEY = "mc-welcome-done";
let justNamed = false;
let lbTab = "friends", lbPer = "week", lbSeq = 0;
const lbData = { friends: {}, global: {} };
const lbFrom = per => dayKey(per === "week" ? mondayOf(new Date()) : addDays(new Date(), -29));

async function loadBoard(){
  const seq = ++lbSeq, tab = lbTab, per = lbPer;
  renderBoard();
  if(tab === "friends" && per === "week") return;   // that's S.board, already loaded
  const args = { p_from: lbFrom(per), p_to: dayKey() };
  const { data, error } = await sb.rpc(tab === "global" ? "global_board" : "following_board", args);
  lbData[tab][per] = error ? { error: error.message } : { rows: data || [] };
  if(seq === lbSeq) renderBoard();
}

const boardHead = label => `<div class="brow bhead"><span class="rk">#</span><span></span><span class="who">Player</span><span></span><span class="sc">${label}</span><span class="pl">Played</span></div>`;
function boardRow(rank, uid, name, handle, score, played, act = ""){
  const me = uid === S.user.id;
  return `<div class="brow ${me ? "me" : ""} ${rank === 1 ? "first" : ""}"><span class="rk">${rank}</span>${avatar(uid, name)}
    <div class="who"><b>${esc(me ? S.profile.display_name : name)}</b>${me ? `<span>you</span>` : handle ? `<span>@${esc(handle)}</span>` : ""}</div>
    <span class="act">${act}</span><span class="sc">${score}</span><span class="pl">${played}</span></div>`;
}

function renderBoard(){
  if(!S.user || !S.profile) return;
  document.querySelectorAll("[data-lbtab]").forEach(b => b.classList.toggle("on", b.dataset.lbtab === lbTab));
  document.querySelectorAll("[data-lbper]").forEach(b => b.classList.toggle("on", b.dataset.lbper === lbPer));
  const per = lbPer === "week" ? "this week" : "over the last 30 days";
  $("lbSub").textContent = lbTab === "friends" ? `You and the people you follow, ${per}.` : `Everyone on Mindclub, ${per}.`;
  $("lbHow").textContent = lbTab === "friends"
    ? "A win is the best score on a puzzle at least two of you played. Ties share it. Friends' scores only count on puzzles you played too, so nothing gets spoiled."
    : "On every puzzle you get up to 10 points: the share of other players you beat, with a tie counting half. Only totals are shown, never scores. Guest accounts aren't listed.";
  const box = $("board");
  const d = lbTab === "friends" && lbPer === "week" ? { rows: S.board } : lbData[lbTab][lbPer];
  if(!d){ box.innerHTML = `<div class="nofriends">Loading…</div>`; return; }
  if(d.error){ box.innerHTML = `<div class="notice err">Couldn't load the leaderboard: ${esc(d.error)}</div>`; return; }

  if(lbTab === "friends"){
    box.innerHTML = boardHead("Wins") + weekBoard(d.rows).map(x => boardRow(x.rank, x.uid, x.n, null, x.wins, x.played)).join("")
      + (following().length ? "" : `<div class="nofriends bnote">Follow friends to compete with them. <button class="linkbtn" data-view="people">Find people</button></div>`);
    return;
  }
  const rows = d.rows;
  const mine = new Set(following().map(p => p.user_id));
  const html = rows.map((r, i) => {
    const gap = i && r.rank > rows[i-1].rank + 1 && r.user_id === S.user.id ? `<div class="bgap">…</div>` : "";
    const act = r.user_id === S.user.id || mine.has(r.user_id) ? "" : `<button class="btn ghost" data-follow="${r.user_id}">Follow</button>`;
    return gap + boardRow(r.rank, r.user_id, r.display_name, r.handle, +(+r.points).toFixed(1), r.played, act);
  }).join("");
  box.innerHTML = rows.length ? boardHead("Points") + html : `<div class="nofriends">Nobody has played ${per} yet.</div>`;
  if(isGuest()) box.innerHTML += `<div class="nofriends bnote">Guests aren't on this board. Add your email to join it.</div>`;
}

/* ================= challenges ================= */
// open: still playable; won/lost/tied/noscore: both played; declined; missed: the day passed.
function chState(c){
  if(c.status === "declined") return "declined";
  const mine = c.my_label != null;
  if(mine && c.their_played){
    if(c.my_score == null || c.their_score == null) return "noscore";
    return c.my_score < c.their_score ? "won" : c.my_score > c.their_score ? "lost" : "tied";
  }
  return daysAgo(c.day) > 1 ? "missed" : "open";
}
const OUTCOME = { won:["win","You won"], lost:["loss","You lost"], tied:["","Tied"], noscore:["","No score to compare"],
                  declined:["","Declined"], missed:["","Not finished"] };

function chRow(c, compact){
  const g = G(c.game) || { name: c.game, url: "#", id: c.game };
  const st = chState(c), mine = c.my_label != null;
  const when = c.day === dayKey() ? "today" : daysAgo(c.day) === 1 ? "yesterday" : prettyDay(c.day);
  const who = c.outgoing ? `You challenged <b>${esc(c.other_name)}</b>` : `<b>${esc(c.other_name)}</b> challenged you`;
  const sub = `${esc(g.name)} · ${when}${c.note ? ` · <span class="note">"${esc(c.note)}"</span>` : ""}`;
  let right = "";
  if(st === "open" && !mine){
    right = `<a class="btn dark" href="${g.url}" target="_blank" rel="noopener" data-play="${g.id}">Play</a>`
      + (compact ? "" : c.outgoing ? `<button class="linkbtn" data-cancel="${c.id}">Cancel</button>` : `<button class="linkbtn" data-decline="${c.id}">Decline</button>`);
  } else if(st === "open"){
    right = `<span class="score">You: ${esc(c.my_label)}</span>`
      + (compact ? "" : `<span class="gsub">${c.their_played ? "" : `Waiting for ${esc(c.other_name)}`}</span>`)
      + (c.outgoing && !compact ? `<button class="linkbtn" data-cancel="${c.id}">Cancel</button>` : "");
  } else {
    const [cls, text] = OUTCOME[st];
    const vs = ["won","lost","tied","noscore"].includes(st) ? `<span class="score">${esc(c.my_label)} vs ${esc(c.their_label ?? "Played")}</span>` : "";
    right = `${vs}<span class="outcome ${cls}">${text}</span>`;
  }
  return `<div class="ch">${avatar(c.other_id, c.other_name)}<div class="what">${who}<span class="gsub">${sub}</span></div><div class="acts">${right}</div></div>`;
}

function renderChallenges(){
  const all = S.challenges;
  const waitingMe = all.filter(c => chState(c) === "open" && c.my_label == null);
  const waitingThem = all.filter(c => chState(c) === "open" && c.my_label != null);
  const finished = all.filter(c => chState(c) !== "open");
  const empty = t => `<div class="nofriends">${t}</div>`;
  $("chIn").innerHTML = waitingMe.length ? waitingMe.map(c => chRow(c)).join("") : empty("Nothing to play right now.");
  $("chOut").innerHTML = waitingThem.length ? waitingThem.map(c => chRow(c)).join("") : empty("Nobody owes you a result.");
  $("chDone").innerHTML = finished.length ? finished.map(c => chRow(c)).join("") : empty("Finished challenges show up here.");
  $("chInCount").textContent = waitingMe.length || "";
  $("chOutCount").textContent = waitingThem.length || "";
  $("chBadge").hidden = !waitingMe.length; $("chBadge").textContent = waitingMe.length;
  // Rail: anything waiting on you, else the latest finished one.
  const rail = waitingMe.length ? waitingMe.slice(0,3) : finished.filter(c => daysAgo(c.day) <= 1).slice(0,2);
  $("chPanel").hidden = !rail.length;
  $("chPanelN").textContent = waitingMe.length ? `${waitingMe.length} to play` : "";
  $("chRail").innerHTML = rail.map(c => chRow(c, true)).join("");
}

let chPre = null;   // someone to tick when the challenge box opens from their People row
function openChallenge(gameId, who = null){
  const fers = followers();
  chPre = who;
  if(!fers.length){
    toast("Nobody follows you yet. Send them your link first.", { label: "Copy link", run: copyLink });
    return;
  }
  const games = GAMES.filter(g => shownGames().includes(g) || g.id === gameId);
  $("chGame").innerHTML = games.map(g => `<option value="${g.id}" ${g.id === gameId ? "selected" : ""}>${esc(g.name)}${todays(g.id) ? ` (you: ${esc(todays(g.id).label)})` : ""}</option>`).join("");
  if(!gameId){ const played = games.find(g => todays(g.id)); if(played) $("chGame").value = played.id; }
  $("chWho").innerHTML = "";
  drawChWho();
  $("chNote").value = ""; $("chErr").hidden = true; $("chSend").disabled = false;
  $("chBg").classList.add("open");
}
function drawChWho(){
  const game = $("chGame").value, today = dayKey(), fers = followers();
  const already = new Set(S.challenges.filter(c => c.outgoing && c.game === game && c.day === today).map(c => c.other_id));
  const ticked = new Set([...$("chWho").querySelectorAll("input:checked")].map(b => b.value));   // keep picks when the game changes
  if(chPre) ticked.add(chPre);
  $("chWho").innerHTML = fers.map(p => `<label>
      <input type="checkbox" value="${p.user_id}" ${already.has(p.user_id) ? "disabled" : fers.length === 1 || ticked.has(p.user_id) ? "checked" : ""}>
      ${avatar(p.user_id, p.display_name)}${esc(p.display_name)}<span class="gsub">${already.has(p.user_id) ? "already challenged" : "@" + esc(p.handle)}</span></label>`).join("");
}
const closeCh = () => $("chBg").classList.remove("open");
$("chGame").onchange = drawChWho;
$("chAll").onclick = () => {
  const boxes = [...$("chWho").querySelectorAll("input:not(:disabled)")];
  const on = boxes.some(b => !b.checked);
  boxes.forEach(b => b.checked = on);
};
$("chBg").onclick = e => { if(e.target.id === "chBg") closeCh(); };
$("chForm").onsubmit = async e => {
  e.preventDefault();
  const ids = [...$("chWho").querySelectorAll("input:checked")].map(b => b.value);
  const err = m => { $("chErr").hidden = false; $("chErr").textContent = m; };
  if(!ids.length) return err("Pick at least one person.");
  $("chSend").disabled = true;
  const game = $("chGame").value;
  const { data, error } = await sb.rpc("send_challenge", { p_to: ids, p_game: game, p_day: dayKey(), p_note: $("chNote").value.trim() || null });
  $("chSend").disabled = false;
  if(error) return err(/follow you/.test(error.message) ? "You can only challenge people who follow you." : /too many/.test(error.message) ? "That's a lot of challenges for one day. Try again tomorrow." : error.message);
  closeCh();
  toast(data ? `${G(game).name} challenge sent to ${data === 1 ? nameOf(ids[0]) : data + " people"}` : "You'd already challenged them on this one");
  loadSocial();
};
async function chAction(rpc, id, msg){
  const { error } = await sb.rpc(rpc, { p_id: id });
  if(error) return toast("Couldn't do that: " + error.message);
  toast(msg); loadSocial();
}

/* ================= people ================= */
let peopleTab = "following", found = [], invited = null;
function personRow(p, hl, inList){
  const me = p.user_id === S.user.id;
  const tag = p.follows_me && !me ? `<span> · follows you</span>` : "";
  let acts = "";
  if(me) acts = `<span class="gsub">That's you</span>`;
  else if(p.i_follow) acts = `<button class="btn ghost" data-unfollow="${p.user_id}">Following</button>`;
  else acts = `<button class="btn primary" data-follow="${p.user_id}">${p.follows_me ? "Follow back" : "Follow"}</button>`;
  // Challenges go to people who follow you (send_challenge enforces it).
  if(!me && p.follows_me) acts = `<button class="btn ghost" data-chwith="${p.user_id}">Challenge</button>` + acts;
  if(inList && peopleTab === "followers" && p.follows_me) acts += `<button class="linkbtn" data-rmfollower="${p.user_id}" title="Stop them following you">Remove</button>`;
  return `<div class="person ${hl ? "hl" : ""}">${avatar(p.user_id, p.display_name)}
    <div class="who"><b>${esc(p.display_name)}</b><span>@${esc(p.handle)}</span>${tag}</div><div class="acts">${acts}</div></div>`;
}
function renderPeople(){
  const fing = following(), fers = followers();
  $("followingN").textContent = fing.length; $("followersN").textContent = fers.length;
  document.querySelectorAll("[data-ptab]").forEach(b => b.classList.toggle("on", b.dataset.ptab === peopleTab));
  const list = peopleTab === "following" ? fing : fers;
  $("peopleList").innerHTML = list.length ? list.map(p => personRow(p, false, true)).join("")
    : `<div class="nofriends">${peopleTab === "following" ? "You don't follow anyone yet. Find friends by handle above, or open their link." : "Nobody follows you yet. Send friends your link."}</div>`;
  // Search results and an invite reflect the latest follow state.
  const fresh = p => ({ ...p, ...(S.people.find(x => x.user_id === p.user_id) || { i_follow: false, follows_me: p.follows_me }) });
  const rows = (invited ? [invited] : []).concat(found.filter(p => p.user_id !== invited?.user_id));
  $("findList").innerHTML = rows.map(p => personRow(fresh(p), p === invited)).join("")
    || ($("findInput").value.trim().length >= 2 ? `<div class="nofriends" style="margin-top:8px">Nobody with a handle starting "${esc(cleanHandle($("findInput").value))}".</div>` : "");
}
let findT = null, findSeq = 0;
$("findInput").addEventListener("input", () => {
  clearTimeout(findT);
  findT = setTimeout(async () => {
    const q = cleanHandle($("findInput").value), seq = ++findSeq;
    if(q.length < 2){ found = []; return renderPeople(); }
    const { data } = await sb.rpc("find_people", { p_q: q });
    if(seq !== findSeq) return;
    found = data || []; renderPeople();
  }, 200);
});
$("findForm").onsubmit = e => e.preventDefault();

// Someone opened a friend's link (?u=handle, maybe &g=game): offer a one-tap follow on Today.
let inviteGame = null;
async function showInvited(handle, game){
  const { data } = await sb.rpc("find_people", { p_q: handle });
  const p = (data || []).find(x => x.handle === handle);
  if(!p) return toast(`Couldn't find @${handle}`);
  invited = p; inviteGame = game || null;
  showView("today"); render();
}
function renderInvite(){
  const bar = $("inviteBar");
  if(!invited){ bar.hidden = true; return; }
  const p = { ...invited, ...(S.people.find(x => x.user_id === invited.user_id) || {}) };
  const g = G(inviteGame), name = esc(p.display_name), mine = g && todays(g.id);
  bar.hidden = false;
  if(!p.i_follow){
    bar.innerHTML = `${avatar(p.user_id, p.display_name)}<div class="itext"><b>${name}</b> <span class="gsub">@${esc(p.handle)}</span>
        <div>${g ? `wants you to beat their ${esc(g.name)} today.` : "sent you their link."} Follow them to compare scores. You'll see theirs once you've played.</div></div>
      <div class="iacts"><button class="btn primary" data-follow="${p.user_id}">Follow ${name}</button><button class="linkbtn" data-act="dropinvite">Not now</button></div>`;
  } else if(g && !mine){
    bar.innerHTML = `${avatar(p.user_id, p.display_name)}<div class="itext">You follow <b>${name}</b>. Play today's ${esc(g.name)}, then log it to see who won.</div>
      <div class="iacts"><a class="btn dark" href="${g.url}" target="_blank" rel="noopener" data-play="${g.id}">Play ${esc(g.name)}</a><button class="linkbtn" data-act="dropinvite">Close</button></div>`;
  } else {
    bar.innerHTML = `${avatar(p.user_id, p.display_name)}<div class="itext">You follow <b>${name}</b>. ${g ? `Your ${esc(g.name)} is on the card below.` : "Their results show on your Today page."}</div>
      <div class="iacts"><button class="linkbtn" data-act="dropinvite">Close</button></div>`;
  }
}

/* ================= streak + daily reminder ================= */
function renderStreak(s){
  const playedToday = S.mine.some(r => r.day === dayKey());
  $("streakPill").hidden = s < 2;
  $("streakPill").textContent = `${s}-day streak`;
  const bar = $("streakBar");
  if(s > 0 && !playedToday){
    bar.hidden = false;
    bar.innerHTML = `<div class="sn serif">${s}</div><div class="itext"><b>${s === 1 ? "You played yesterday. Log a game today to start a 2-day streak" : `Keep your ${s}-day streak going`}</b>
      <div class="muted">Log any game today. ${new Date().getHours() >= 18 ? "It resets at midnight." : ""}</div></div>
      <div class="iacts"><button class="linkbtn" data-act="remind">Remind me daily</button></div>`;
  } else bar.hidden = true;
}
function openRemind(){
  $("remTime").value = local.get("mc-rem-time") || "08:00";
  $("remBg").classList.add("open");
}
// A repeating calendar event (.ics) works on every phone and computer, with no notifications server.
function reminderIcs(time){
  const [hh, mm] = time.split(":"), t = new Date(); t.setDate(t.getDate() + 1);
  const ymd = `${t.getFullYear()}${String(t.getMonth()+1).padStart(2,"0")}${String(t.getDate()).padStart(2,"0")}`;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const url = location.origin + location.pathname;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mindclub//Daily reminder//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:mindclub-daily-${S.profile.handle}@mindclub`, `DTSTAMP:${now}`, `DTSTART:${ymd}T${hh}${mm}00`, "DURATION:PT10M",
    "RRULE:FREQ=DAILY", "SUMMARY:Daily puzzles", `DESCRIPTION:Play today's puzzles and log them: ${url}`, `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:PT0M", "DESCRIPTION:Daily puzzles", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
}
$("remBg").onclick = e => { if(e.target.id === "remBg") $("remBg").classList.remove("open"); };
$("remForm").onsubmit = e => {
  e.preventDefault();
  const time = $("remTime").value || "08:00";
  local.set("mc-rem-time", time);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([reminderIcs(time)], { type: "text/calendar" }));
  a.download = "daily-puzzles-reminder.ics";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("remBg").classList.remove("open");
  toast("Open the downloaded file to add the reminder to your calendar");
};

/* ================= share a result ================= */
const shareUrl = game => `${location.origin}${location.pathname}?u=${S.profile.handle}${game ? "&g=" + game : ""}`;
// Worded so it never looks like a game's own share text (auto-log ignores it).
function shareText(gameId){
  const r = todays(gameId), g = G(gameId);
  return r && r.score != null && r.score < FAIL ? `I got ${r.label} on today's ${g.name}. Think you can beat me?`
       : `I played today's ${g.name}. Think you can beat me?`;
}
async function shareResult(gameId){
  const text = shareText(gameId), url = shareUrl(gameId);
  if(navigator.share && TOUCH){
    try { await navigator.share({ text, url }); return; }
    catch(e){ if(e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast("Copied. Paste it to a friend or your group chat."); }
  catch(e){ toast("Couldn't copy. Your link is on the People page."); }
}
function personById(uid){
  return S.people.find(p => p.user_id === uid) || found.find(p => p.user_id === uid) || (invited?.user_id === uid ? invited : null)
    || Object.values(lbData.global).flatMap(d => d.rows || []).find(p => p.user_id === uid);
}
async function follow(uid){
  const p = personById(uid);
  const { error } = await sb.rpc("follow", { p_user: uid });
  if(error) return toast("Couldn't follow: " + error.message);
  toast(`You follow ${p?.display_name || "them"}`);
  await loadPeople(); loadSocial();
}
async function unfollow(uid){
  const p = personById(uid);
  if(!confirm(`Unfollow ${p?.display_name || "them"}? You'll stop seeing their results.`)) return;
  const { error } = await sb.rpc("unfollow", { p_user: uid });
  if(error) return toast("Couldn't unfollow: " + error.message);
  await loadPeople(); loadSocial();
}
async function removeFollower(uid){
  const p = personById(uid);
  if(!confirm(`Remove ${p?.display_name || "them"} as a follower? They'll stop seeing your results.`)) return;
  const { error } = await sb.rpc("remove_follower", { p_user: uid });
  if(error) return toast("Couldn't remove: " + error.message);
  await loadPeople();
}
async function copyLink(){
  try { await navigator.clipboard.writeText(profileUrl()); toast("Your link is copied. Send it to friends."); }
  catch(e) { toast("Couldn't copy. Select the link on the People page instead."); }
}

/* ================= games page ================= */
function renderPicker(){
  const shown = shownGames();
  $("pickCount").textContent = `${shown.length} of ${GAMES.length}`;
  const pq = ($("pickSearch").value || "").trim().toLowerCase();
  $("picker").innerHTML = GAMES.filter(g => !pq || (g.name + " " + g.by).toLowerCase().includes(pq)).map(g => `<label class="pick ${shown.includes(g) ? "" : "off"}">
    <input type="checkbox" data-pick="${g.id}" ${shown.includes(g) ? "checked" : ""}>${iconHtml(g)}
    <div><div class="gname">${g.name}</div><div class="gsub">${esc(g.by)}</div></div></label>`).join("");
}
$("picker").addEventListener("change", async e => {
  const id = e.target.dataset.pick; if(!id) return;
  const before = S.profile.games;
  let ids = shownGames().map(g => g.id).filter(x => x !== id);
  if(e.target.checked) ids.push(id);
  ids = GAMES.map(g => g.id).filter(x => ids.includes(x));   // keep the usual order
  const games = ids.length === GAMES.length ? null : ids;   // everything ticked: also shows games added later
  S.profile.games = games; render();
  const { error } = await sb.from("profiles").update({ games }).eq("id", S.user.id);
  if(error){ S.profile.games = before; render(); toast("Couldn't save: " + error.message); }
});

let suggestions = null;
async function loadSuggestions(){
  const { data, error } = await sb.rpc("list_game_suggestions");
  if(error){ $("suggestions").innerHTML = `<div class="nofriends">Couldn't load suggestions.</div>`; return; }
  suggestions = data; renderSuggestions();
}
function renderSuggestions(){
  if(!suggestions) return;
  $("suggestions").innerHTML = suggestions.length ? suggestions.map(s => `<div class="sug">
      <button class="vote ${s.voted ? "on" : ""}" data-vote="${s.id}" aria-pressed="${s.voted}" title="${s.voted ? "Take back your vote" : "Vote for this"}">${s.votes} ${s.votes === 1 ? "vote" : "votes"}</button>
      <div class="sname">${esc(s.name)}${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : ""}</div>
      ${s.mine ? `<span class="gsub">your idea</span>` : ""}
    </div>`).join("")
    : `<div class="nofriends">No suggestions yet. Be the first.</div>`;
}
$("suggestForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("sugName").value.trim(), url = $("sugUrl").value.trim();
  const have = GAMES.find(g => g.name.toLowerCase().replace(/^the /, "") === name.toLowerCase().replace(/^the /, ""));
  const err = msg => { $("sugErr").hidden = false; $("sugErr").textContent = msg; };
  if(have) return err(`Mindclub already has ${have.name}. Tick it under Show on Today.`);
  if(name.length < 2) return err("Enter the game's name.");
  $("sugErr").hidden = true;
  const btn = e.submitter || $("suggestForm").querySelector("button"); btn.disabled = true;
  const { error } = await sb.rpc("suggest_game", { p_name: name, p_url: url || null });
  btn.disabled = false;
  if(error) return err(/too many/.test(error.message) ? "That's a lot of suggestions for one day. Try again tomorrow." : error.message);
  $("sugName").value = ""; $("sugUrl").value = "";
  await loadSuggestions();
  toast("Thanks. Your suggestion is in.");
};
async function vote(id){
  const s = suggestions?.find(x => x.id === id); if(!s) return;
  const on = !s.voted;
  s.voted = on; s.votes += on ? 1 : -1; renderSuggestions();
  const { error } = await sb.rpc("vote_game_suggestion", { p_id: id, p_on: on });
  if(error) toast("Couldn't save your vote: " + error.message);
  loadSuggestions();
}

// Equal scores share a rank (1, 1, 3). "Played" with no score goes last, unranked.
function rankOf(x, people){
  if(x.score == null) return "";
  return 1 + people.filter(o => o.score != null && o.score < x.score).length;
}

function ago(iso){
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`;
}

function renderHistory(){
  const now = new Date(), end = addDays(mondayOf(now), 6), start = addDays(end, -20*7 + 1);
  const counts = {}; S.mine.forEach(r => counts[r.day] = (counts[r.day]||0) + 1);
  let cells = "", total = 0;
  for(let d = new Date(start); d <= end; d = addDays(d,1)){
    const n = counts[dayKey(d)] || 0; total += n;
    const lvl = n === 0 ? "" : n < 2 ? "l1" : n < 4 ? "l2" : "l3";
    cells += `<i class="${lvl}" title="${dayKey(d)}: ${n} games" style="${d > now ? "opacity:.35" : ""}"></i>`;
  }
  $("heat").innerHTML = cells; $("heatTotal").textContent = `${total} results`;

  const w = S.mine.filter(r => r.game === "wordle" && r.score != null && r.score < FAIL);
  const fav = Object.entries(S.mine.reduce((a,r) => (a[r.game] = (a[r.game]||0) + 1, a), {})).sort((a,b) => b[1]-a[1])[0];
  $("stats").innerHTML = [
    [S.mine.length, "results logged"], [new Set(S.mine.map(r => r.day)).size, "days played"],
    [w.length ? (w.reduce((a,r) => a + r.score, 0) / w.length).toFixed(1) : "None", "Wordle average"],
    [fav ? (G(fav[0])?.name || fav[0]) : "None", "most played"],
  ].map(([v,k]) => `<div class="panel stat"><div class="v">${esc(v)}</div><div class="k">${k}</div></div>`).join("");

  const rows = [...S.mine].sort((a,b) => b.day.localeCompare(a.day) || b.created_at.localeCompare(a.created_at));
  $("histRows").innerHTML = rows.length ? rows.map(r => `<tr><td>${new Date(r.day + "T12:00").toLocaleDateString(undefined,{day:"numeric",month:"short"})}</td>
    <td>${G(r.game)?.name || esc(r.game)}${r.puzzle ? ` <span class="gsub">#${esc(r.puzzle)}</span>` : ""}</td><td class="mono">${esc(r.label)}</td>
    <td>${r.stars ? r.stars + "/5" : ""}</td><td class="right"><button class="linkbtn" data-remove="${esc(r.game)}|${r.day}">Remove</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">Nothing logged yet.</td></tr>`;
}

/* ================= log modal ================= */
let detected = null, stars = 0;
function openModal(text=""){
  $("modalBg").classList.add("open");
  $("paste").value = text; stars = 0; drawStars(); onInput();
  setTimeout(() => (detected ? $("save") : $("paste")).focus(), 30);
}
const closeModal = () => $("modalBg").classList.remove("open");
let detectedDay = null;
function onInput(){
  detected = parse($("paste").value);
  detectedDay = detected ? resultDay(detected) : null;
  const ago = detectedDay ? daysAgo(detectedDay) : 0;
  const tooOld = ago > MAX_BACKFILL;
  const d = $("detect");
  d.classList.toggle("ok", !!detected && !tooOld);
  d.classList.toggle("warn", tooOld);
  if(!detected){
    d.innerHTML = $("paste").value.trim()
      ? `Couldn't recognise that text. If it's from a game Mindclub doesn't have yet, <button class="linkbtn" data-view="games">suggest it</button>.`
      : "Paste a result above.";
  } else {
    const head = `<b>${G(detected.game).name}${detected.puzzle ? " #" + esc(detected.puzzle) : ""}</b><span class="lbl mono">${esc(detected.label)}</span>`;
    const existing = loggedOn(detected.game, detectedDay);
    const sub = tooOld ? `That puzzle is from ${prettyDay(detectedDay)}. You can log results from the last ${MAX_BACKFILL} days.`
      : ago > 0 ? `This is ${ago === 1 ? "yesterday's" : prettyDay(detectedDay) + "'s"} puzzle, so it'll be saved to that day.`
      : "";
    const repl = existing && !tooOld ? `This replaces the ${esc(existing.label)} you logged${ago ? " for that day" : " today"}.` : "";
    d.innerHTML = `<div class="dhead">${head}</div>${sub || repl ? `<div class="dnote">${[sub, repl].filter(Boolean).join(" ")}</div>` : ""}`;
  }
  $("save").disabled = !detected || tooOld;
}
function drawStars(){ $("stars").innerHTML = [1,2,3,4,5].map(i => `<button data-star="${i}" class="${i <= stars ? "on" : ""}" aria-label="${i} stars">★</button>`).join(""); }
function toast(t, action){
  const el = $("toast");
  el.textContent = t;
  el.classList.toggle("actionable", !!action);
  if(action){
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove("show"); action.run(); };
    el.append(b);
  }
  el.classList.add("show"); clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), action ? 8000 : 2600);
}
async function saveDetected(){
  if(!detected || $("save").disabled) return;
  $("save").disabled = true;
  const d = detected, day = detectedDay || dayKey();
  if(await saveResult({ ...d, stars }, day)){
    closeModal();
    toast(`${G(d.game).name} logged${day === dayKey() ? "" : " for " + prettyDay(day)}`,
          day === dayKey() ? { label: "Share", run: () => shareResult(d.game) } : null);
  }
  else $("save").disabled = false;
}

$("gameChips").innerHTML = GAMES.map(g => `<span class="chip">${iconHtml(g)}${esc(g.name)}</span>`).join("");
$("keyHint").textContent = KEYV;
if(TOUCH){
  document.querySelector("#dropzone b").textContent = "Copied a result? Tap Paste";
  $("paste").placeholder = "Tap here and paste the text the game's Share button copied";
}
$("dropGames").textContent = `Works with ${GAMES.slice(0,-1).map(g => g.name.replace(/^The /, "the ")).join(", ")} and ${GAMES.at(-1).name}.`;
$("samples").innerHTML = Object.keys(SAMPLES).map(k => `<button data-fill="${k}">${k}</button>`).join("");
$("paste").addEventListener("input", onInput);
$("save").onclick = saveDetected;
$("modalBg").onclick = e => { if(e.target.id === "modalBg") closeModal(); };

/* ================= small prompt ================= */
let askResolve = null;
function ask({ title, desc, placeholder = "", value = "", button, value2 = null }){
  $("askTitle").textContent = title; $("askDesc").textContent = desc; $("askBtn").textContent = button;
  $("askInput").placeholder = placeholder; $("askInput").value = value;
  const two = value2 != null;
  $("askInput2").hidden = $("askLabel2").hidden = !two; $("askInput2").required = two;
  if(two) $("askInput2").value = value2;
  $("askErr").hidden = true; $("askBtn").disabled = false;
  $("askBg").classList.add("open"); setTimeout(() => $("askInput").focus(), 30);
  return new Promise(res => askResolve = res);
}
const closeAsk = () => { $("askBg").classList.remove("open"); askResolve = null; };
const askError = msg => { $("askErr").hidden = false; $("askErr").textContent = msg; $("askBtn").disabled = false; };
$("askForm").onsubmit = e => { e.preventDefault(); $("askBtn").disabled = true; askResolve?.($("askInput").value.trim()); };
$("askBg").onclick = e => { if(e.target.id === "askBg") closeAsk(); };

const handleError = m => /taken/.test(m) ? "That handle is taken. Try another."
  : /handle must/.test(m) ? "Handles are 3 to 20 letters, numbers or _." : m;
// Saves name and handle. Returns an error message, or null when saved.
async function saveProfile(name, handle){
  name = name.trim().slice(0,40); handle = cleanHandle(handle);
  if(!name) return "Enter your name.";
  if(!/^[a-z0-9_]{3,20}$/.test(handle)) return "Handles are 3 to 20 letters, numbers or _.";
  if(handle !== S.profile.handle){
    const { error } = await sb.rpc("set_handle", { p_handle: handle });
    if(error) return handleError(error.message);
    S.profile.handle = handle;
  }
  if(name !== S.profile.display_name){
    const { error } = await sb.from("profiles").update({ display_name: name }).eq("id", S.user.id);
    if(error) return error.message;
    S.profile.display_name = name;
  }
  return null;
}
async function rename(){
  let name = await ask({ title:"Your profile", desc:"Your name is what people see. Your handle is how they find you.",
                         value:S.profile.display_name, button:"Save", value2:S.profile.handle });
  while(name != null){
    const err = await saveProfile(name, $("askInput2").value);
    if(!err){ closeAsk(); toast("Profile saved"); return render(); }
    askError(err);
    name = await new Promise(res => askResolve = res);
  }
}
$("nameForm").onsubmit = async e => {
  e.preventDefault();
  const err = await saveProfile($("nameInput").value, $("handleInput").value);
  $("nameErr").hidden = !err; $("nameErr").textContent = err || "";
  if(err) return;
  justNamed = true;
  document.activeElement.blur(); render(); toast("Saved");
};

/* ================= events ================= */
function showView(v){
  closeModal();
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "view-" + v));
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.view === v)); window.scrollTo(0,0);
  if(v === "games") loadSuggestions();
  if(v === "people" || v === "challenges") { loadPeople(); loadSocial(); }
  if(v === "leaderboard") loadBoard();
  if(v === "people" && !invited) setTimeout(() => $("findInput").focus(), 30);
}
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-share],[data-view],[data-played],[data-play],[data-star],[data-fill],[data-remove],[data-vote],[data-follow],[data-unfollow],[data-rmfollower],[data-challenge],[data-chwith],[data-toggle],[data-decline],[data-cancel],[data-ptab],[data-lbtab],[data-lbper],[data-act]"); if(!el) return;
  const d = el.dataset;
  if(d.share) shareResult(d.share);
  if(d.view) showView(d.view);
  if(d.vote) vote(d.vote);
  if(d.follow) follow(d.follow);
  if(d.unfollow) unfollow(d.unfollow);
  if(d.rmfollower) removeFollower(d.rmfollower);
  if(d.challenge != null) openChallenge(d.challenge);
  if(d.chwith) openChallenge("", d.chwith);
  if(d.toggle) toggleRow(el);
  if(d.decline) chAction("decline_challenge", d.decline, "Challenge declined");
  if(d.cancel) chAction("cancel_challenge", d.cancel, "Challenge cancelled");
  if(d.ptab){ peopleTab = d.ptab; renderPeople(); }
  if(d.lbtab){ lbTab = d.lbtab; loadBoard(); }
  if(d.lbper){ lbPer = d.lbper; loadBoard(); }
  if(d.played){ if(await saveResult({ game:d.played, label:"Played", score:null })) toast(`${G(d.played).name} saved`); }
  if(d.play){ local.set("mc-pending", { game:d.play, at:Date.now() }); setTimeout(render, 300); }
  if(d.remove){ const [g, day] = d.remove.split("|"); removeResult(g, day); }
  if(d.star){ stars = stars === +d.star ? 0 : +d.star; drawStars(); }
  if(d.fill){ $("paste").value = SAMPLES[d.fill]; onInput(); }
  switch(d.act){
    case "log": openModal(); break;
    case "closemodal": closeModal(); break;
    case "closeask": closeAsk(); break;
    case "closech": closeCh(); break;
    case "challenge": openChallenge(""); break;
    case "pasteclip": { let t = ""; try { t = await navigator.clipboard.readText(); } catch(err) {} openModal(t); break; }
    case "backplayed": { const g = local.get("mc-pending")?.game; if(g && await saveResult({ game:g, label:"Played", score:null })) toast(`${G(g).name} saved`); break; }
    case "rename": rename(); break;
    case "copylink": copyLink(); break;
    case "wdone": local.set(WELCOME_KEY, 1); render(); break;
    case "autoon": enableAuto(); break;
    case "exton": connectExtension(); break;
    case "extoff": disconnectExtension(); break;
    case "autooff": local.set("mc-auto", false); render(); toast("Auto-log is off"); break;
    case "authback": $("authSent").hidden = true; $("authAsk").hidden = false; $("authEmail").focus(); break;
    case "guest": signInGuest(); break;
    case "dropinvite": invited = null; inviteGame = null; render(); break;
    case "remind": openRemind(); break;
    case "closerem": $("remBg").classList.remove("open"); break;
    case "tour": openTour(0); break;
    case "tournext": tourGo(1); break;
    case "tourback": tourGo(-1); break;
    case "hidedemo": local.set("mc-demo-off", true); render(); break;
    case "toemail": e.preventDefault(); $("signin").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("authEmail").focus({ preventScroll: true }), 300); break;
    case "signout":
      if(isGuest() && !confirm("Sign out of this guest account? Guest accounts can't be signed back into, so your results and followers will be lost. To keep them, add your email first.")) break;
      // Otherwise the extension would keep logging into this account after you sign out.
      if(extState() === "connected") await disconnectExtension(true);
      await sb.auth.signOut();
      ["mc-pending","mc-clip-last","mc-follow"].forEach(k => local.set(k, null));
      invited = null; found = []; S.people = []; S.board = []; S.challenges = []; S.profile = null;
      showView("today");
      break;
    case "retry": loadAll(); break;
  }
});

const modalOpen = () => ["modalBg","askBg","chBg","remBg","tourBg"].some(id => $(id).classList.contains("open"));
document.addEventListener("paste", e => {
  if(!S.user || modalOpen() || ["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) return;
  e.preventDefault(); openModal(e.clipboardData.getData("text"));
});
const dz = $("dropzone");
document.addEventListener("dragover", e => { if(!S.user) return; e.preventDefault(); dz.classList.add("hot"); });
document.addEventListener("dragleave", e => { if(!e.relatedTarget) dz.classList.remove("hot"); });
document.addEventListener("drop", e => { if(!S.user) return; e.preventDefault(); dz.classList.remove("hot"); openModal(e.dataTransfer.getData("text")); });
document.addEventListener("keydown", e => {
  if(e.key === "Escape"){ closeModal(); closeAsk(); closeCh(); $("remBg").classList.remove("open"); if($("tourBg").classList.contains("open")) endTour(); }
  if(e.key === "/" && S.user && !modalOpen() && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)){ e.preventDefault(); showView("today"); $("gameSearch").focus(); }
  if((e.key === "Enter" || e.key === " ") && document.activeElement?.dataset?.toggle){ e.preventDefault(); toggleRow(document.activeElement); }
  if(e.key === "Enter" && (e.metaKey || e.ctrlKey) && $("modalBg").classList.contains("open")) saveDetected();
  if(S.user && !modalOpen() && e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)){ e.preventDefault(); openModal(); }
});
// Coming back to this tab: reload, so results logged elsewhere (extension, phone) show up.
document.addEventListener("visibilitychange", () => { if(!document.hidden && S.user && S.profile) loadAll(); });

/* ================= auto-log from clipboard =================
   When you come back to this tab, read the clipboard once. If it holds a game
   result you haven't logged today, save it and offer Undo. Anything that isn't
   a game result is ignored and never leaves the browser. */
let clipPermission = "unknown";   // granted | prompt | denied | unsupported
const autoOn = () => clipPermission === "granted" && local.get("mc-auto") !== false
  && document.documentElement.dataset.mindclubExt !== "connected";   // the extension handles it

async function checkClipPermission(){
  if(!navigator.clipboard?.readText || !navigator.permissions?.query){ clipPermission = "unsupported"; return; }
  try {
    const p = await navigator.permissions.query({ name: "clipboard-read" });
    clipPermission = p.state;
    p.onchange = () => { clipPermission = p.state; renderAuto(); };
  } catch(e) { clipPermission = "unsupported"; }   // Safari and Firefox
}

async function enableAuto(){
  try { await navigator.clipboard.readText(); } catch(e) {}
  await checkClipPermission();
  if(clipPermission === "granted"){ local.set("mc-auto", true); toast("Auto-log is on"); }
  else toast("Your browser didn't allow clipboard access");
  render();
}

const hashText = t => [...t].reduce((h,c) => (h * 31 + c.codePointAt(0)) | 0, 7);

let autoBusy = false;
async function autoCheck(){
  if(!S.user || !S.profile || !autoOn() || autoBusy || modalOpen() || !document.hasFocus()) return;
  autoBusy = true;
  try {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch(e) { return; }
    const p = parse(text);
    if(!p) return;
    const key = hashText(text);
    if(local.get("mc-clip-last") === key) return;     // already handled this exact text
    local.set("mc-clip-last", key);
    if(resultDay(p) !== dayKey()){ openModal(text); return; }   // older puzzle: let the user confirm
    if(todays(p.game)) return;                         // never overwrite silently
    if(await saveResult(p)){
      toast(`${G(p.game).name} ${p.label} logged`, { label: "Undo", run: () => undoResult(p.game) });
    }
  } finally { autoBusy = false; }
}

async function removeResult(game, day){
  const prev = loggedOn(game, day);
  const { error } = await sb.from("results").delete().eq("user_id", S.user.id).eq("game", game).eq("day", day);
  if(error) return toast("Couldn't remove: " + error.message);
  S.mine = S.mine.filter(r => !(r.game === game && r.day === day));
  await loadSocial();
  toast(`${G(game)?.name || game} removed`, prev && { label: "Undo", run: () => saveResult(prev, day) });
}

async function undoResult(game){
  const { error } = await sb.from("results").delete().eq("user_id", S.user.id).eq("game", game).eq("day", dayKey());
  if(error) return toast("Couldn't undo: " + error.message);
  S.mine = S.mine.filter(r => !(r.game === game && r.day === dayKey()));
  await loadSocial(); toast(`${G(game).name} removed`);
}

/* ================= browser extension =================
   The extension's bridge script marks <html data-mindclub-ext="installed|connected">
   and talks to this page with window.postMessage. */
const extState = () => document.documentElement.dataset.mindclubExt || "";
window.addEventListener("message", e => {
  if(e.source !== window || e.origin !== location.origin || !e.data?.__mindclubExt) return;
  if(e.data.type === "connected"){
    toast(e.data.ok ? "Extension connected. Results now log from the game page when you tap Share." : "Couldn't connect the extension");
  }
  render();
});

async function connectExtension(){
  if(!extState()) return toast("Install the Mindclub extension first, then click Connect in it",
    CAN_EXT && { label: "Install", run: () => window.open(EXT_URL, "_blank", "noopener") });
  const { data: token, error } = await sb.rpc("create_device_token", { p_label: "Chrome extension" });
  if(error) return toast("Couldn't connect the extension: " + error.message);
  window.postMessage({ __mindclubSite: true, type: "connect", token }, location.origin);
}
async function disconnectExtension(quiet){
  await sb.rpc("revoke_device_tokens");
  window.postMessage({ __mindclubSite: true, type: "disconnect" }, location.origin);
  if(!quiet) toast("Extension disconnected");
}

function renderAuto(){
  const el = $("howPanel"); if(!el) return;
  el.hidden = extState() === "connected";
  if(extState() === "connected"){
    el.innerHTML = `<h3>Extension connected</h3><ol>
      <li>Click <b>Play</b> to open the game in a new tab.</li>
      <li>Finish it and tap the game's <b>Share</b> button.</li>
      <li>It's logged. You don't need to come back here.</li></ol>
      <button class="linkbtn" data-act="extoff">Disconnect extension</button>`;
    return;
  }
  if(extState() === "installed"){
    el.innerHTML = `<h3>Connect the extension</h3>
      <p class="note" style="margin-top:0">The Mindclub extension is installed. Connect it and results log straight from the game page when you tap Share.</p>
      <button class="btn primary" data-act="exton" style="width:100%;justify-content:center">Connect extension</button>`;
    return;
  }
  const manual = `<ol>
      <li>${TOUCH ? "Tap" : "Click"} <b>Play</b> to open the game.</li>
      <li>Finish it and tap the game's <b>Share</b> button.</li>
      <li>Come back here and ${TOUCH ? "tap <b>Paste</b>" : `press <b>${KEYV}</b>`}.</li></ol>`;
  if(TOUCH){ el.innerHTML = `<h3>How logging works</h3>${manual}`; return; }
  // Desktop Chrome/Brave/Edge without the extension: it's the easiest way, so offer it first.
  if(CAN_EXT && !extState()){
    el.innerHTML = `<h3>Log without pasting</h3>
      <p class="note" style="margin-top:0">Add the Mindclub extension. Tap <b>Share</b> in a game and it's logged, right there on the game page.</p>
      <a class="btn primary" href="${EXT_URL}" target="_blank" rel="noopener" style="width:100%;justify-content:center">Add to ${/Brave|Edg\//.test(navigator.userAgent) || navigator.brave ? "browser" : "Chrome"}, free</a>
      <p class="note">After it's installed, come back here and click <b>Connect</b>.</p>
      <details><summary>Other ways to log</summary>${autoOn()
        ? `<p class="note">Auto-log is on: come back to this tab after tapping Share. <button class="linkbtn" data-act="autooff">Turn off</button></p>`
        : clipPermission === "prompt" || clipPermission === "granted"
          ? `<p class="note">Or turn on <button class="linkbtn" data-act="autoon">auto-log</button>: it reads your clipboard when you come back to this tab.</p>` : ""}${manual}</details>`;
    return;
  }
  if(autoOn()){
    el.innerHTML = `<h3>Auto-log is on</h3><ol>
      <li>Click <b>Play</b> to open the game in a new tab.</li>
      <li>Finish it and tap the game's <b>Share</b> button.</li>
      <li>Come back to this tab. It logs itself.</li></ol>
      <button class="linkbtn" data-act="autooff">Turn off</button>`;
  } else if(clipPermission === "denied"){
    el.innerHTML = `<h3>How logging works</h3>${manual}
      <p class="note">Auto-log is blocked because clipboard access is off for this site. You can allow it from the site settings next to the address bar.</p>`;
  } else if(clipPermission === "unsupported"){
    el.innerHTML = `<h3>How logging works</h3>${manual}
      <p class="note">Auto-log works in Chrome, Edge, Arc and Brave. This browser needs the ${KEYV} step.</p>`;
  } else {
    el.innerHTML = `<h3>Skip the paste step</h3>
      <p class="note" style="margin-top:0">Turn on auto-log and your result saves itself when you come back from a game. Mindclub only reads your clipboard at that moment, and only keeps it if it's a game result.</p>
      <button class="btn primary" data-act="autoon" style="width:100%;justify-content:center">Turn on auto-log</button>
      <details><summary>Or log by hand</summary>${manual}</details>`;
  }
}

window.addEventListener("focus", () => setTimeout(autoCheck, 150));
document.addEventListener("visibilitychange", () => { if(!document.hidden) setTimeout(autoCheck, 300); });
checkClipPermission().then(() => { renderAuto(); autoCheck(); });
setInterval(() => { if(!document.hidden && S.user) loadSocial(); }, 60000);

sb.auth.getSession().then(({ data }) => { if(!data.session) showAuth(); });

/* ================= search + rows ================= */
function toggleRow(head){
  const row = head.closest(".grow"), id = head.dataset.toggle;
  const open = !row.classList.contains("open");
  row.classList.toggle("open", open); head.setAttribute("aria-expanded", open);
  open ? openRows.add(id) : openRows.delete(id);
}
$("gameSearch").addEventListener("input", render);
$("gameSearch").addEventListener("keydown", e => { if(e.key === "Escape"){ e.target.value = ""; render(); e.target.blur(); } });
$("pickSearch").addEventListener("input", renderPicker);

/* ================= first-login tour =================
   Five short cards. Shown once per browser after the first sign-in; "How it works" in the sidebar replays it. */
const TOUR_KEY = "mc-tour-1";
const mockRow = (id, r, cls = "") => { const g = G(id); return `<div class="mrow">${iconHtml(g)}${g.name}<span class="r ${cls}">${r}</span></div>`; };
const TOUR = [
  { art: `<div class="big">mindclub</div>`, title: "Your daily puzzles, in one place",
    text: "Wordle, Connections, Queens, Krillion and more: log the ones you play and see your friends' results right next to yours." },
  { art: () => `<div class="mock">${mockRow("wordle", "Play →")}${mockRow("connections", "✓ Perfect", "good")}</div>`,
    title: "Play, then log it",
    text: () => extState() === "connected" ? "Hit Play to open a game. When you finish, tap the game's own Share button. The extension logs it for you."
      : TOUCH ? "Hit Play to open a game. When you finish, tap the game's Share button, come back and tap Paste."
      : `Hit Play to open a game. When you finish, tap the game's Share button, then press ${KEYV} anywhere here.`,
    extra: () => CAN_EXT && !extState() ? `<a class="btn primary" href="${EXT_URL}" target="_blank" rel="noopener">Get the extension: no pasting</a>` : "" },
  { art: () => `<div class="mock">${mockRow("queens", "1:07", "blur")}${mockRow("waffle", "5/5 ★", "blur")}</div>`, title: "No spoilers",
    text: "Friends' scores stay blurred until you've played the same puzzle. Play first, then see how you did." },
  { art: () => `<div class="mock"><div class="mrow"><div class="av" style="background:#e8457f">M</div>@maya<span class="r good">Following</span></div><div class="mrow"><div class="av" style="background:#0891b2">S</div>@sam_k<span class="r">Follow</span></div></div>`,
    title: "Bring your friends", text: "Follow people by their @handle, or send them your link. You see results from everyone you follow.",
    extra: () => `<button class="btn ghost" data-act="copylink">Copy my link</button>` },
  { art: () => `<div class="mock">${["Maya","You","Sam"].map((n, i) => `<div class="mrow"><span class="r ${i ? "" : "pink"}" style="margin:0;width:14px">${i + 1}</span>${n}<span class="r ${i ? "" : "pink"}">${[4,3,1][i]} wins</span></div>`).join("")}</div>`,
    title: "Win the week", text: "Every puzzle you both play is a head-to-head: the best score wins. The weekly board shows who's ahead, and you can challenge followers to beat your score." },
];
let tourAt = 0;
const val = v => typeof v === "function" ? v() : (v || "");
function openTour(i){ tourAt = i; paintTour(); $("tourBg").classList.add("open"); }
function paintTour(){
  const t = TOUR[tourAt];
  $("tourArt").innerHTML = val(t.art);
  $("tourStep").textContent = `${tourAt + 1} of ${TOUR.length}`;
  $("tourTitle").textContent = t.title;
  $("tourText").textContent = val(t.text);
  $("tourExtra").innerHTML = val(t.extra);
  $("tourExtra").hidden = !val(t.extra);
  $("tourDots").innerHTML = TOUR.map((_, i) => `<i class="${i === tourAt ? "on" : ""}"></i>`).join("");
  $("tourBack").textContent = tourAt ? "Back" : "Skip";
  $("tourNext").textContent = tourAt === TOUR.length - 1 ? "Let's play" : "Next";
}
function tourGo(d){
  if(d < 0 && !tourAt) return endTour();
  if(d > 0 && tourAt === TOUR.length - 1) return endTour();
  tourAt += d; paintTour();
}
function endTour(){ local.set(TOUR_KEY, true); $("tourBg").classList.remove("open"); }
$("tourBg").onclick = e => { if(e.target.id === "tourBg") endTour(); };
