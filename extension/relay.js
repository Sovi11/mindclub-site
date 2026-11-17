// Runs beside capture.js in the extension's isolated world. Forwards captured share text to
// the background worker, which parses and logs it, and shows a small toast with the outcome.
(() => {
  let last = "", lastAt = 0;

  window.addEventListener("message", async e => {
    if (e.source !== window || e.data?.__mindclubCapture !== true || typeof e.data.text !== "string") return;
    const text = e.data.text;
    if (text === last && Date.now() - lastAt < 5000) return;   // Share often writes the same text twice
    last = text; lastAt = Date.now();
    let r;
    try { r = await chrome.runtime.sendMessage({ type: "share", text }); } catch (err) { return; }
    if (r) toast(r);   // in a game iframe the background sends the toast to the top frame instead
  });

  if (window === window.top) {
    chrome.runtime.onMessage.addListener(msg => { if (msg?.type === "toast" && msg.r) toast(msg.r); });
  }

  function toast(r) {
    const name = `${r.game} ${r.label}`;
    const [title, body, link] = {
      saved:         [`${name} logged`, "Friends who played today can see it now.", ["Open Mindclub", r.siteUrl]],
      exists:        [`${r.game} is already logged`, `Mindclub keeps your first result for ${r.day === r.today ? "today" : r.day}.`, ["Open Mindclub", r.siteUrl]],
      not_connected: [`${name}: not logged`, r.revoked ? "This browser was disconnected from Mindclub." : "Connect the extension to log results.", ["Connect", r.connectUrl]],
      old:           [`${name}: not logged`, "That's an older puzzle. Log it on the site instead.", ["Open Mindclub", r.siteUrl]],
      error:         [`${name}: not logged`, r.message || "Something went wrong.", ["Open Mindclub", r.siteUrl]],
    }[r.status] || [];
    if (!title) return;

    document.getElementById("mindclub-toast")?.remove();
    const host = document.createElement("div");
    host.id = "mindclub-toast";
    const root = host.attachShadow({ mode: "closed" });
    const ok = r.status === "saved" || r.status === "exists";
    root.innerHTML = `
      <style>
        .t{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(340px,calc(100vw - 32px));
           display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;
           background:#1f1c17;color:#f3ede2;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
           box-shadow:0 8px 28px rgba(0,0,0,.28);animation:in .18s ease-out}
        @keyframes in{from{opacity:0;transform:translateY(8px)}}
        .dot{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;
             font-weight:700;font-size:13px;color:#fff}
        b{display:block;font-weight:600}
        span{color:#a1968a}
        a{color:#ff7a4d;font-weight:600;text-decoration:none;white-space:nowrap}
        a:hover{text-decoration:underline}
        button{all:unset;cursor:pointer;color:#a1968a;padding:0 2px;font-size:16px;line-height:1}
      </style>
      <div class="t" role="status">
        <div class="dot"></div>
        <div><b></b><span></span> <a target="_blank" rel="noopener"></a></div>
        <button aria-label="Close">×</button>
      </div>`;
    const dot = root.querySelector(".dot");
    dot.textContent = ok ? "✓" : "!";
    dot.style.background = ok ? (r.color || "#2f7d4f") : "#e2552d";
    root.querySelector("b").textContent = `Mindclub: ${title}`;
    root.querySelector("span").textContent = body;
    const a = root.querySelector("a");
    a.textContent = link[0]; a.href = link[1];
    root.querySelector("button").onclick = () => host.remove();
    (document.body || document.documentElement).appendChild(host);
    setTimeout(() => host.remove(), ok ? 6000 : 12000);
  }
})();
