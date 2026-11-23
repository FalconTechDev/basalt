// Injected into the Basalt vault window (see run.mjs). Everything hangs off window.__S.
(() => {
  const S = window.__S = window.S = {};
  const Y = () => window.__bsY.Y;
  S.view = () => app.workspace.getLeavesOfType('basalt-board').map((l) => l.view)[0];
  S.lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
  S.heap = () => Math.round(performance.memory.usedJSHeapSize / 1048576);
  S.dom = () => document.getElementsByTagName('*').length;
  S.timers = {};
  const sum = (a) => { if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, med: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length }; };
  S.sum = sum;
  S.wrap = (v) => {
    for (const n of ['sync', 'syncEdges', 'renderMd', 'paintMini', 'applyCam', 'renderInk', 'guide', 'sizeSnap', 'publish', 'mark', 'renderSelBar']) {
      const o = v[n]; if (typeof o !== 'function' || o.__w) continue;
      v[n] = function (...a) { const t = performance.now(); try { return o.apply(this, a); } finally { const d = performance.now() - t, r = S.timers[n] || (S.timers[n] = { n: 0, t: 0, max: 0 }); r.n++; r.t += d; if (d > r.max) r.max = d; } }; v[n].__w = 1;
    }
  };
  S.tstat = () => { const o = {}; for (const [k, r] of Object.entries(S.timers)) o[k] = { n: r.n, tot: Math.round(r.t), avg: +(r.t / r.n).toFixed(2), max: Math.round(r.max) }; return o; };
  S.clearStats = () => { S.timers = {}; S.lt.length = 0; };
  S.raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  S.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // frame recorder: rAF deltas while something runs
  S.recStart = () => { const r = S._rec = { d: [], on: true }; let last = performance.now(); const f = (t) => { if (!r.on) return; r.d.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); };
  S.recStop = () => { S._rec.on = false; const d = S._rec.d.slice(1); return sum(d); };
  // open a fresh board file (closes previous)
  S.fresh = async (name) => {
    for (const l of app.workspace.getLeavesOfType('basalt-board')) l.detach();
    await S.sleep(200);
    const p = name + '.board'; let f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f); f = await app.vault.create(p, '');
    const leaf = app.workspace.getLeaf(true); await leaf.setViewState({ type: 'basalt-board', state: { path: p }, active: true });
    await S.sleep(800); const v = S.view(); S.wrap(v); S.clearStats(); await S.raf(); return p;
  };
  const WORDS = 'alpha beta gamma delta epsilon zeta theta kappa lambda sigma omega note idea task plan draft review budget design model graph node link card board people city river stone'.split(' ');
  const rnd = (seed) => { let s = seed | 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
  S.rnd = rnd;
  S.lorem = (len, seed) => { const r = rnd(seed + 7); let t = ''; let i = 0; while (t.length < len) { const w = WORDS[Math.floor(r() * WORDS.length)]; t += (i++ % 17 === 0 ? '**' + w + '** ' : i % 23 === 0 ? '[[' + w + ']] ' : w + ' '); } return t.slice(0, len); };
  S.bigMd = (seed) => {
    let t = '# Heading ' + seed + '\n\n'; let k = 0;
    const part = () => {
      let s = '## Section ' + (k++) + '\n' + S.lorem(300, seed + k) + '\n\n| a | b | c | d |\n|---|---|---|---|\n';
      for (let r = 0; r < 4; r++) s += '| ' + S.lorem(8, r) + ' | ' + r + ' | [link](https://example.com/' + r + ') | x |\n';
      s += '\n- item one\n  - nested a\n    - nested deeper [[Note ' + k + ']]\n  - nested b\n- item two\n\n';
      for (let c = 0; c < 5; c++) s += '- [' + (c % 2 ? 'x' : ' ') + '] task ' + k + '.' + c + ' https://example.org/p' + c + '\n';
      return s + '\n';
    };
    while (t.length < 19500) t += part();
    return t.slice(0, 20000);
  };
  // make n cards on a grid, in one transaction. opts: text(i)->string, w,h,dx,dy,prefix, color
  S.addCards = (n, o) => {
    o = o || {}; const v = S.view(), y = Y(), cols = o.cols || Math.ceil(Math.sqrt(n * 1.5)), W = o.w || 260, H = o.h || 110, dx = o.dx || 300, dy = o.dy || 150, pre = o.prefix || 'c', ids = [];
    const t0 = performance.now();
    v.doc.transact(() => { for (let i = 0; i < n; i++) { const m = new y.Map(), t = new y.Text(); m.set('x', (i % cols) * dx); m.set('y', Math.floor(i / cols) * dy); m.set('w', W); m.set('h', H); m.set('color', o.color ? (i % 7 ? '' : '#e5484d') : ''); m.set('by', 'stress'); v.stampM(m); t.insert(0, o.text ? o.text(i) : ''); m.set('text', t); if (o.img) m.set('img', o.img(i)); const id = pre + i; v.yn.set(id, m); ids.push(id); } });
    return { ms: Math.round(performance.now() - t0), n: ids.length };
  };
  S.addEdges = (n, o) => {
    o = o || {}; const v = S.view(), y = Y(), keys = Array.from(v.yn.keys()), r = rnd(5), N = keys.length; const t0 = performance.now();
    v.doc.transact(() => { for (let i = 0; i < n; i++) { const a = keys[i % N], b = keys[Math.min(N - 1, (i % N) + 1 + Math.floor(r() * 12))]; if (a === b) continue; const m = new y.Map(); m.set('a', a); m.set('b', b); m.set('label', i % 50 === 0 ? 'lbl' : ''); if (o.curve) m.set('sh', i % 2 ? 'curve' : 'elbow'); v.ye.set('e' + i, m); } });
    return Math.round(performance.now() - t0);
  };
  S.addInk = (n, pts, o) => {
    o = o || {}; const v = S.view(), a = v.inkArr(), r = rnd(11), N = o.span || 20000; const t0 = performance.now(); const arr = [];
    for (let i = 0; i < n; i++) { const cx = r() * N * 1.2, cy = r() * N * 0.8, p = []; let x = cx, yy = cy; for (let j = 0; j < pts; j++) { x += (r() - 0.45) * 12; yy += (r() - 0.5) * 12; p.push([Math.round(x * 10) / 10, Math.round(yy * 10) / 10]); } arr.push({ id: 'i' + i, k: 'pen', pts: p, c: i % 3 ? '' : '#3fa7d6', w: 4 }); }
    const tg = performance.now() - t0; v.doc.transact(() => { for (let i = 0; i < arr.length; i += 500) a.push(arr.slice(i, i + 500)); });
    return { gen: Math.round(tg), ms: Math.round(performance.now() - t0 - tg) };
  };
  // PNG of noise (distinct per seed)
  S.noiseImg = (seed, side) => { const cv = document.createElement('canvas'); cv.width = cv.height = side; const c = cv.getContext('2d'), im = c.createImageData(side, side), r = rnd(seed); for (let i = 0; i < im.data.length; i += 4) { im.data[i] = r() * 255; im.data[i + 1] = r() * 255; im.data[i + 2] = r() * 255; im.data[i + 3] = 255; } c.putImageData(im, 0, 0); return cv.toDataURL('image/png'); };
  // camera moves, one per rAF, recorded: mode 'pan' | 'zoom'
  S.camRun = async (mode, frames, px) => { // pan: px screen pixels per frame

    px = px || 25;
    const v = S.view(); const c0 = Object.assign({}, v.cam); S.lt.length = 0; S.recStart();
    for (let i = 0; i < frames; i++) { await new Promise((r) => requestAnimationFrame(r)); if (mode === 'pan') { v.cam.x = c0.x + i * px / v.cam.k; v.cam.y = c0.y + i * px * 0.32 / v.cam.k; } else { v.cam.k = Math.max(0.12, Math.min(2, c0.k * Math.pow(1.04, (i % 40 < 20 ? i % 20 : 20 - i % 20)))); } v.applyCam(); }
    await S.raf(); const fr = S.recStop(); v.cam = c0; v.applyCam(); return Object.assign({ lt: sum(S.lt) }, fr);
  };
  S.gcState = () => ({ heap: S.heap(), dom: S.dom(), cards: S.view().els.size, edges: S.view().edgeEls.size });
  // time one action and the paint after it
  S.timeAct = async (fn) => { S.lt.length = 0; const t0 = performance.now(); const r = await fn(); const t1 = performance.now(); await S.raf(); return { ms: Math.round(t1 - t0), paintMs: Math.round(performance.now() - t1), lt: sum(S.lt), r }; };
  // remote peer: a second Y.Doc kept in step; ops applied at `hz` per second for `secs`
  S.remote = async (hz, secs, per) => {
    const v = S.view(), y = Y(), d2 = new y.Doc(); y.applyUpdate(d2, y.encodeStateAsUpdate(v.doc)); const n2 = d2.getMap('nodes'); const keys = Array.from(n2.keys()), r = rnd(3);
    d2.on('update', (u, origin) => { y.applyUpdate(v.doc, u, 'remote-peer'); });
    S.lt.length = 0; S.timers = {}; S.wrap(v); S.recStart(); const t0 = performance.now(); let ops = 0;
    await new Promise((res) => { const iv = setInterval(() => { d2.transact(() => { for (let k = 0; k < (per || 3); k++) { const id = keys[Math.floor(r() * keys.length)], m = n2.get(id); if (!m) continue; m.set('x', m.get('x') + (r() - 0.5) * 20); m.set('y', m.get('y') + (r() - 0.5) * 20); if (k === 0) { const t = m.get('text'); t.insert(0, 'x'); } ops++; } }); if (performance.now() - t0 > secs * 1000) { clearInterval(iv); res(); } }, 1000 / hz); });
    await S.raf(); const fr = S.recStop(); d2.destroy(); return Object.assign({ ops, lt: sum(S.lt), timers: S.tstat() }, fr);
  };
})();
