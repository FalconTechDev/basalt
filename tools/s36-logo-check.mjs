// Verify the s36 titlebar logo: element exists, PNG href resolves and the image decoded.
const port = 10060;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value;

const info = await run(`(async () => {
  const btn = document.querySelector(".titlebar-button.mod-logo");
  if (!btn) return { btn: false };
  const img = btn.querySelector("image");
  const path = btn.querySelector("path");
  const out = { btn: true, href: img && img.getAttribute("href"), cls: img && img.closest("svg").getAttribute("class"), wire: !!path };
  if (img) {
    const url = new URL(img.getAttribute("href"), location.href).href;
    out.resolved = url;
    try {
      const r = await fetch(url);
      out.fetchStatus = r.status; out.fetchType = r.headers.get("content-type");
      const buf = await r.arrayBuffer(); out.bytes = buf.byteLength;
    } catch (e) { out.fetchErr = String(e); }
    // decode check via Image
    out.natural = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im.naturalWidth + "x" + im.naturalHeight);
      im.onerror = () => res("error");
      im.src = url;
      setTimeout(() => res("timeout"), 5000);
    });
  }
  return out;
})()`);
console.log(JSON.stringify(info, null, 1));
ws.close();
process.exit(0);
