// Runs on the Mindclub site. Tells the page the extension is here (<html data-mindclub-ext>)
// and carries the device key from the page to the extension when you click Connect.
// Protocol is defined by app.js: the page posts {__mindclubSite, type: "connect", token} or
// {type: "disconnect"}; we answer with {__mindclubExt, type: "connected", ok} and {type: "state"}.
(() => {
  const root = document.documentElement;
  const tell = (type, extra) => window.postMessage({ __mindclubExt: true, type, ...extra }, location.origin);

  async function sync() {
    const { token } = await chrome.storage.local.get("token");
    root.dataset.mindclubExt = token ? "connected" : "installed";
    tell("state");
  }

  root.dataset.mindclubExt = "installed";
  sync();
  document.addEventListener("DOMContentLoaded", () => tell("state"));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && "token" in changes) sync(); });

  window.addEventListener("message", async e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.__mindclubSite !== true) return;
    if (e.data.type === "connect") {
      const ok = typeof e.data.token === "string" && /^[0-9a-f]{64}$/.test(e.data.token)
        && !!(await chrome.runtime.sendMessage({ type: "connect", token: e.data.token }))?.ok;
      tell("connected", { ok });
    } else if (e.data.type === "disconnect") {
      await chrome.runtime.sendMessage({ type: "disconnect" });
    }
  });
})();
