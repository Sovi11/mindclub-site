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
// A profile link (?u=handle) is remembered across the email sign-in round trip.
const urlFollow = new URLSearchParams(location.search).get("u");
if(urlFollow){ local.set("mc-follow", cleanHandle(urlFollow)); history.replaceState(null, "", location.pathname); }
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
  if(u?.id === S.user?.id) return;
  S.user = u;
  // Defer: calling Supabase inside this callback can deadlock the auth client.
  setTimeout(() => u ? boot() : showAuth(), 0);
});

function showAuth(){
  $("appScreen").hidden = true; $("authScreen").hidden = false;
  $("joinBadge").hidden = !local.get("mc-follow");
}

async function boot(){
  $("authScreen").hidden = true; $("appScreen").hidden = false;
  await loadAll();
  const h = local.get("mc-follow");
  if(h && S.profile){ local.set("mc-follow", null); if(h !== S.profile.handle) showInvited(h); }
  if(local.get("mc-connect-ext")){ local.set("mc-connect-ext", null); setTimeout(connectExtension, 300); }
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
  const unnamed = S.profile.display_name === (S.user.email || "").split("@")[0];
  $("hello").textContent = `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}${unnamed ? "" : ", " + first}`;
  const shown = shownGames();
  const onToday = GAMES.filter(g => shown.includes(g) || todays(g.id));
  const done = onToday.filter(g => todays(g.id)).length;
  $("todaySub").textContent = `${now.toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"})} · ${done} of ${onToday.length} played`;
  $("gridFoot").innerHTML = `${shown.length < GAMES.length ? `Showing ${shown.length} of ${GAMES.length} games. ` : ""}<button class="linkbtn" data-view="games">Choose games</button> or <button class="linkbtn" data-view="games">suggest one we're missing</button>`;

  // First-run welcome: shown until you follow someone or someone follows you.
  const fing = following(), fers = followers();
  $("welcome").hidden = S.people.length > 0;
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
    : "Tap Share in the game, then press ⌘V here.";
  renderAuto();

  const today = dayKey();
  const ordered = [...onToday].sort((a,b) => !!todays(a.id) - !!todays(b.id));
  $("games").innerHTML = ordered.map(g => {
    const mine = todays(g.id);
    const rows = S.board.filter(r => r.day === today && r.game === g.id && r.user_id !== S.user.id)
      .map(r => ({ uid: r.user_id, name: nameOf(r.user_id), label: r.revealed ? r.label : "hidden", score: r.score }));
    let people = rows;
    if(mine){
      people = rows.concat({ uid: S.user.id, name: "You", me: true, label: mine.label, score: mine.score });
      people.sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity));
    }
    const scores = people.map(x => x.score).filter(s => s != null && s < FAIL);
    const best = scores.length ? Math.min(...scores) : null;
    const friendsLine = fing.length ? `${rows.length} of ${fing.length} you follow played` : "Follow friends to compare";
    const list = people.length
      ? people.map(x => `<div class="p ${x.me ? "me" : ""} ${mine && x.score === best && best != null ? "best" : ""}">
          ${mine ? `<span class="rank">${rankOf(x, people)}</span>` : ""}${avatar(x.uid, x.name)}${esc(x.name)}<span class="res">${esc(x.label)}</span></div>`).join("")
      : `<div class="nofriends">${fing.length ? "Nobody you follow has played yet." : "Your result shows here once you log it."}</div>`;
    const dared = S.challenges.filter(c => !c.outgoing && c.game === g.id && c.day === today && c.status === "open");
    const daredLine = dared.length && !mine
      ? `<div class="chbadge">${esc(dared.slice(0,2).map(c => c.other_name).join(" and "))}${dared.length > 2 ? ` and ${dared.length - 2} more` : ""} challenged you</div>` : "";
    return `<article class="card">
      <div class="ghead">
        ${iconHtml(g)}
        <div><div class="gname">${g.name}</div><div class="gsub">${g.by} · ${friendsLine}</div></div>
        <div class="right">${mine ? `<span class="mine">${esc(mine.label)}</span>`
          : `<a class="btn dark" href="${g.url}" target="_blank" rel="noopener" data-play="${g.id}">Play</a>`}</div>
      </div>
      ${daredLine}
      <div class="people ${mine ? "" : "locked"}">
        ${list}
        ${!mine && rows.length ? `<div class="lock">Log yours to see their scores.</div>` : ""}
      </div>
      ${mine ? `<div class="cardfoot quiet"><button class="linkbtn" data-challenge="${g.id}">Challenge followers</button><button class="linkbtn" data-act="log">Change</button><button class="linkbtn" data-remove="${g.id}|${today}">Remove</button></div>`
             : `<div class="cardfoot"><button class="btn ghost" data-act="log">Paste result</button><button class="btn ghost" data-played="${g.id}">I played, no score</button></div>`}
    </article>`;
  }).join("");

  // streak + week
  const s = streak();
  $("streakN").textContent = s; $("streakLbl").textContent = s === 1 ? "day" : "days";
  const monday = mondayOf(now);
  $("week").innerHTML = [...Array(7)].map((_,i) => {
    const d = addDays(monday,i), k = dayKey(d), n = S.mine.filter(r => r.day === k).length;
    return `<div class="wd"><div class="dot ${n ? "full" : ""} ${k === today ? "today" : ""}">${n || ""}</div>${d.toLocaleDateString(undefined,{weekday:"narrow"})}</div>`;
  }).join("");

  // rail
  $("followCount").textContent = `${fing.length} following · ${fers.length} follower${fers.length === 1 ? "" : "s"}`;
  const counts = {}; S.board.forEach(r => counts[r.user_id] = (counts[r.user_id]||0) + 1);
  const lb = [{ user_id: S.user.id }, ...fing].map(m => ({ uid: m.user_id, n: nameOf(m.user_id), v: counts[m.user_id] || 0 })).sort((a,b) => b.v - a.v);
  const max = Math.max(...lb.map(x => x.v), 1);
  $("lb").innerHTML = lb.map(x => `<div class="row ${x.uid === S.user.id ? "me" : ""}">${avatar(x.uid, x.n)}
    <span style="width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.n)}</span><div class="bar"><i style="width:${x.v/max*100}%"></i></div><span class="n">${x.v}</span></div>`).join("")
    + (fing.length ? "" : `<div class="nofriends" style="margin-top:4px">Follow friends to see how they're doing this week.</div>`);

  const feed = S.board.filter(r => r.day === today && r.user_id !== S.user.id).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,6);
  $("feed").innerHTML = feed.length ? feed.map(r => `<div class="item">${avatar(r.user_id, nameOf(r.user_id))}
    <div><b>${esc(nameOf(r.user_id))}</b> finished ${G(r.game)?.name || esc(r.game)}${r.revealed ? ` · <span class="mono">${esc(r.label)}</span>` : ""}
    <div class="t">${ago(r.created_at)}</div></div></div>`).join("")
    : `<div class="nofriends">${fing.length ? "Quiet so far today." : "Results from people you follow show up here."}</div>`;

  renderChallenges();
  renderPeople();
  renderHistory();
  renderPicker();
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

function openChallenge(gameId){
  const fers = followers();
  if(!fers.length){
    toast("Nobody follows you yet. Send them your link first.", { label: "Copy link", run: copyLink });
    return;
  }
  const games = GAMES.filter(g => shownGames().includes(g) || g.id === gameId);
  $("chGame").innerHTML = games.map(g => `<option value="${g.id}" ${g.id === gameId ? "selected" : ""}>${esc(g.name)}${todays(g.id) ? ` (you: ${esc(todays(g.id).label)})` : ""}</option>`).join("");
  if(!gameId){ const played = games.find(g => todays(g.id)); if(played) $("chGame").value = played.id; }
  drawChWho();
  $("chNote").value = ""; $("chErr").hidden = true; $("chSend").disabled = false;
  $("chBg").classList.add("open");
}
function drawChWho(){
  const game = $("chGame").value, today = dayKey(), fers = followers();
  const already = new Set(S.challenges.filter(c => c.outgoing && c.game === game && c.day === today).map(c => c.other_id));
  $("chWho").innerHTML = fers.map(p => `<label>
      <input type="checkbox" value="${p.user_id}" ${already.has(p.user_id) ? "disabled" : fers.length === 1 ? "checked" : ""}>
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

async function showInvited(handle){
  const { data } = await sb.rpc("find_people", { p_q: handle });
  const p = (data || []).find(x => x.handle === handle);
  if(!p) return toast(`Couldn't find @${handle}`);
  invited = p; showView("people");
  if(!p.i_follow) toast(`Follow ${p.display_name} to see their results`);
}
function personById(uid){
  return S.people.find(p => p.user_id === uid) || found.find(p => p.user_id === uid) || (invited?.user_id === uid ? invited : null);
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
  $("picker").innerHTML = GAMES.map(g => `<label class="pick ${shown.includes(g) ? "" : "off"}">
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
  if(await saveResult({ ...d, stars }, day)){ closeModal(); toast(`${G(d.game).name} logged${day === dayKey() ? "" : " for " + prettyDay(day)}`); }
  else $("save").disabled = false;
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
  document.activeElement.blur(); render(); toast("Saved");
};

/* ================= events ================= */
function showView(v){
  closeModal();
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "view-" + v));
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.view === v)); window.scrollTo(0,0);
  if(v === "games") loadSuggestions();
  if(v === "people" || v === "challenges") { loadPeople(); loadSocial(); }
  if(v === "people" && !invited) setTimeout(() => $("findInput").focus(), 30);
}
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-view],[data-played],[data-play],[data-star],[data-fill],[data-remove],[data-vote],[data-follow],[data-unfollow],[data-rmfollower],[data-challenge],[data-decline],[data-cancel],[data-ptab],[data-act]"); if(!el) return;
  const d = el.dataset;
  if(d.view) showView(d.view);
  if(d.vote) vote(d.vote);
  if(d.follow) follow(d.follow);
  if(d.unfollow) unfollow(d.unfollow);
  if(d.rmfollower) removeFollower(d.rmfollower);
  if(d.challenge != null) openChallenge(d.challenge);
  if(d.decline) chAction("decline_challenge", d.decline, "Challenge declined");
  if(d.cancel) chAction("cancel_challenge", d.cancel, "Challenge cancelled");
  if(d.ptab){ peopleTab = d.ptab; renderPeople(); }
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
    case "autoon": enableAuto(); break;
    case "exton": connectExtension(); break;
    case "extoff": disconnectExtension(); break;
    case "autooff": local.set("mc-auto", false); render(); toast("Auto-log is off"); break;
    case "authback": $("authSent").hidden = true; $("authAsk").hidden = false; $("authEmail").focus(); break;
    case "signout":
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

const modalOpen = () => ["modalBg","askBg","chBg"].some(id => $(id).classList.contains("open"));
document.addEventListener("paste", e => {
  if(!S.user || modalOpen() || ["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) return;
  e.preventDefault(); openModal(e.clipboardData.getData("text"));
});
const dz = $("dropzone");
document.addEventListener("dragover", e => { if(!S.user) return; e.preventDefault(); dz.classList.add("hot"); });
document.addEventListener("dragleave", e => { if(!e.relatedTarget) dz.classList.remove("hot"); });
document.addEventListener("drop", e => { if(!S.user) return; e.preventDefault(); dz.classList.remove("hot"); openModal(e.dataTransfer.getData("text")); });
document.addEventListener("keydown", e => {
  if(e.key === "Escape"){ closeModal(); closeAsk(); closeCh(); }
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
  if(!extState()) return toast("Install the Mindclub extension first, then click Connect in it");
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
      <li>Click <b>Play</b> to open the game in a new tab.</li>
      <li>Finish it and tap the game's <b>Share</b> button.</li>
      <li>Come back here and press <b>⌘V</b>.</li></ol>`;
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
      <p class="note">Auto-log works in Chrome, Edge, Arc and Brave. This browser needs the ⌘V step.</p>`;
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
