const C = self.MINDCLUB_CONFIG;
const $ = id => document.getElementById(id);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function sym(g) {
  const s = document.createElement("span");
  s.className = "sym"; s.style.background = g.color; s.textContent = g.sym;
  return s;
}

async function render() {
  const { token, recent = [] } = await chrome.storage.local.get(["token", "recent"]);
  $("off").hidden = !!token;
  $("on").hidden = !token;
  $("state").textContent = token ? "Connected" : "Not connected";
  $("state").classList.toggle("on", !!token);
  if (!token) return;

  $("games").replaceChildren(...GAMES.map(g => {
    const a = document.createElement("a");
    a.href = g.url; a.target = "_blank"; a.title = `Play ${g.name} (${g.by})`;
    a.append(sym(g), g.name.replace(/^The /, ""));
    return a;
  }));

  const today = dayKey(), yesterday = dayKey(new Date(Date.now() - 864e5));
  const shown = recent.filter(r => r.day >= yesterday);
  $("recent").replaceChildren(...shown.map(r => {
    const li = document.createElement("li");
    const g = G(r.game) || { color: r.color, sym: "?" };
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: r.name });
    const res = Object.assign(document.createElement("span"), { className: "res", textContent: r.label });
    const when = Object.assign(document.createElement("span"), { className: "when",
      textContent: r.day === today ? "today" : "yesterday" });
    li.append(sym(g), name, res, when);
    return li;
  }));
  $("empty").hidden = shown.length > 0;
}

$("connect").onclick = () => chrome.tabs.create({ url: C.siteUrl + "?connect=extension" });
$("open").onclick = () => chrome.tabs.create({ url: C.siteUrl });
$("disconnect").onclick = async () => {
  await chrome.storage.local.remove("token");
  render();
};
chrome.storage.onChanged.addListener(render);
render();
