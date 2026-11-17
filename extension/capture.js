// Runs in the game page's own JavaScript world, before the page's scripts.
// Watches the ways a Share button hands over its text (clipboard write, copy event, Web Share)
// and passes the text to relay.js. Nothing is blocked or changed: the page's call still runs.
(() => {
  if (window.__mindclubCapture) return;
  window.__mindclubCapture = true;

  const send = text => {
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return;
    window.postMessage({ __mindclubCapture: true, text }, location.origin);
  };
  const wrap = (proto, name, before) => {
    const orig = proto && proto[name];
    if (typeof orig !== "function") return;
    proto[name] = function (...args) {
      try { before.apply(this, args); } catch (e) {}
      return orig.apply(this, args);
    };
  };

  // navigator.clipboard.writeText(text)
  wrap(window.Clipboard?.prototype, "writeText", text => send(String(text)));

  // navigator.clipboard.write([new ClipboardItem({"text/plain": blob})])
  wrap(window.Clipboard?.prototype, "write", items => {
    for (const item of items || []) {
      if (!item?.types?.includes("text/plain")) continue;
      Promise.resolve(item.getType("text/plain")).then(b => b.text()).then(send, () => {});
    }
  });

  // copy handlers that call event.clipboardData.setData("text/plain", text)
  let setDuringCopy = false;
  wrap(window.DataTransfer?.prototype, "setData", (format, data) => {
    if (/^text(\/plain)?$/i.test(format)) { setDuringCopy = true; send(String(data)); }
  });

  // document.execCommand("copy") on a selected textarea or text, with no setData
  window.addEventListener("copy", () => { setDuringCopy = false; }, true);
  window.addEventListener("copy", () => {
    if (setDuringCopy) return;
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && typeof el.selectionStart === "number") {
      send(el.value.slice(el.selectionStart, el.selectionEnd));
    } else {
      send(String(document.getSelection() || ""));
    }
  }, false);

  // navigator.share({ text }) opens the system share sheet on Windows and Mac Chrome
  wrap(window.Navigator?.prototype, "share", data => { if (data?.text) send(String(data.text)); });
})();
