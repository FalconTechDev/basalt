// Minimal Chrome DevTools Protocol client for the headless Basalt (node 22+, global WebSocket/fetch).
// usage: import { connect } from './cdp.mjs'; const c = await connect(9333, /index.html/); await c.eval('1+1');
export async function connect(port, urlRe) {
  let t;
  for (let i = 0; i < 60 && !t; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      t = list.find((x) => x.type === 'page' && (!urlRe || urlRe.test(x.url)) && !/devtools/.test(x.url));
    } catch (e) { /* not up yet */ }
    if (!t) await new Promise((r) => setTimeout(r, 500));
  }
  if (!t) throw new Error('no page matching ' + urlRe);
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(), listeners = [];
  const events = { exceptions: [], crashed: false, logs: [] };
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
    for (const f of listeners) f(d);
    if (d.method === 'Runtime.exceptionThrown') events.exceptions.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').slice(0, 300));
    if (d.method === 'Inspector.targetCrashed') events.crashed = true;
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') events.logs.push(d.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Inspector.enable');
  return {
    send, events, target: t, onEvent(f) { listeners.push(f); },
    // evaluate an expression (promises awaited); throws on exception; timeout in ms
    async eval(expr, timeout = 300000) {
      const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout }), new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), timeout + 5000))]);
      if (!r.result) throw new Error('eval aborted (timeout?) ' + JSON.stringify(r.error || {}).slice(0, 120));
      if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
      return r.result.result.value;
    },
    close() { ws.close(); },
  };
}
