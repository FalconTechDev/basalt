// Board stress runner. usage: node run.mjs <port> <scenario> [n] [tag]
// Scenarios: cards | bigmd | images | links | ink | frame | remote | ops | all ; results are appended to results.jsonl (tag = before/after).
// Needs the headless Basalt with a vault open (see README.md).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { connect } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const [port, scen, nArg, tag] = [+process.argv[2] || 9333, process.argv[3] || 'cards', +process.argv[4] || 0, process.argv[5] || 'run'];
const c = await connect(port, /index\.html/);
await c.send('HeapProfiler.enable');
await c.eval(fs.readFileSync(path.join(here, 'harness.js'), 'utf8'));
const gc = async () => { await c.send('HeapProfiler.collectGarbage'); };
const E = (x, t) => c.eval(x, t || 570000);
const out = { scen, n: nArg, tag, t: new Date().toISOString() };
const done = (extra) => { Object.assign(out, extra, { exc: c.events.exceptions.slice(0, 5), crashed: c.events.crashed, errlogs: c.events.logs.slice(0, 3) }); fs.appendFileSync(path.join(here, 'results.jsonl'), JSON.stringify(out) + '\n'); console.log(JSON.stringify(out)); c.close(); process.exit(0); };
const act = (code) => E(`S.timeAct(()=>{${code}}).then(r=>({ms:r.ms,paintMs:r.paintMs,lt:r.lt}))`);
const cam = async () => { await E(`S.sleep(1500)`); const pan = await E(`S.camRun('pan',90)`); await E(`S.sleep(1500)`); return { pan, zoom: await E(`S.camRun('zoom',90)`) }; };
// the worst case for culling: the whole board in view (fit), then pan and zoom
const camFit = async () => { await E(`S.view().fit()`); await E(`S.sleep(2500)`); const st = await E('S.gcState()'); const panFit = await E(`S.camRun('pan',90,6)`); await E(`S.sleep(1500)`); return { fitState: st, panFit, zoomFit: await E(`S.camRun('zoom',90)`) }; };
const scenarios = {
  async cards() { // 1: n cards with 200 chars
    await E(`S.fresh('s_cards')`); await gc(); const h0 = await E('S.heap()');
    const mk = await act(`return S.addCards(${nArg},{text:(i)=>S.lorem(200,i),color:1})`);
    await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()');
    const c1 = await cam(); const fit = await act(`S.view().fit()`);
    return { h0, mk, state, timers, fit, ...c1, ...(await camFit()) };
  },
  async bigmd() { // 2: huge markdown cards
    await E(`S.fresh('s_bigmd')`); await gc(); const n = nArg || 100;
    const mk = await act(`return S.addCards(${n},{h:400,w:420,dx:460,dy:440,text:(i)=>S.bigMd(i)})`);
    await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()');
    return { mk, state, timers, ...(await cam()) };
  },
  async images() { // 3: n image cards with ~1.5MB distinct data URLs
    await E(`S.fresh('s_images')`); const n = nArg || 200;
    await E(`window.__imgs=[]; for(let i=0;i<${n};i++) window.__imgs.push(S.noiseImg(i+1,610)); 1`, 580000);
    const imgBytes = await E('window.__imgs[0].length'); await gc();
    const mk = await act(`return S.addCards(${n},{h:220,w:260,dx:300,dy:260,text:(i)=>'img '+i,img:(i)=>window.__imgs[i]})`);
    await new Promise((r) => setTimeout(r, 3000)); await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()');
    return { imgBytes, mk, state, timers, ...(await cam()) };
  },
  async links() { // 4: n links between n/2 cards
    await E(`S.fresh('s_links')`); const n = nArg || 5000; const cards = Math.max(1000, Math.round(n / 2));
    await E(`S.addCards(${cards},{text:(i)=>S.lorem(80,i)})`); await E(`S.clearStats()`);
    const mk = await act(`return S.addEdges(${n},{})`);
    await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()');
    const oneMove = await act(`const v=S.view(),m=v.yn.get('c5');v.doc.transact(()=>{m.set('x',m.get('x')+10);})`);
    return { cards, mk, state, timers, oneMove, ...(await cam()) };
  },

  async frame() { // 7: a frame with n members (default 1000) dragged with real mouse input, zoomed in and zoomed out, plus 1000 other cards
    await E(`S.fresh('s_frame')`); const n = nArg || 1000; await gc();
    await E(`(()=>{const v=S.view(), y=window.__bsY.Y; S.addCards(${n},{prefix:'m',cols:40,text:(i)=>'member '+i}); S.addCards(1000,{prefix:'b',cols:40,oy:9000,text:(i)=>S.lorem(100,i)}); const rows=Math.ceil(${n}/40); v.doc.transact(()=>{ const m=new y.Map(), t=new y.Text(); m.set('x',-40); m.set('y',-80); m.set('w',40*300+80); m.set('h',rows*150+140); m.set('color',''); m.set('group',true); m.set('by','stress'); v.stampM(m); m.set('text',t); v.yn.set('G',m); for(let i=0;i<${n};i++) v.yn.get('m'+i).set('frame','G'); }); v.um.stopCapturing(); v.um.clear(); return 1})()`);
    const res = {};
    for (const [name, cam] of [['zoomedIn', 'zoom'], ['fit', null]]) {
      await E(cam ? `(()=>{const v=S.view(); v.cam={x:-40+v.root.clientWidth/2-170,y:-80+v.root.clientHeight/2-140,k:1}; v.applyCam();})()` : `S.view().fit()`); await E(`S.sleep(2500)`);
      const g = await E(`(()=>{const v=S.view(), e=v.els.get('G'); if(!e) return null; const gr=e.el.querySelector('.osb-grip'); const b=(gr||e.el).getBoundingClientRect(); const x=b.left+Math.min(b.width/2,60), y=b.top+(gr?b.height/2:1); const t=document.elementFromPoint(x,y); return {x, y, lite:e.lite, hit:t&&t.closest('.osb-root')?((t.closest('.osb-card')||{dataset:{}}).dataset.id||'root'):'outside:'+(t&&t.className)}})()`);
      if (g && !/^(G|root)$/.test(g.hit)) { res[name] = { error: 'press point not on the frame: ' + g.hit }; continue; }
      if (!g) { res[name] = { error: 'no group element' }; continue; }
      const pos0 = await E(`S.view().yn.get('m0').get('x')`);
      await E(`S.clearStats(); S.recStart()`); if (process.env.BS_PROF && name === 'zoomedIn') { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 500 }); await c.send('Profiler.start'); }
      const t0 = Date.now(); const mv = async (type, x, y) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y }); await mv('mousePressed', g.x, g.y);
      for (let i = 1; i <= 40; i++) await mv('mouseMoved', g.x + i * 5, g.y + i * 2);
      await mv('mouseReleased', g.x + 200, g.y + 80); const wall = Date.now() - t0;
      await E(`S.sleep(300)`); if (process.env.BS_PROF && name === 'zoomedIn') { await E(`S.sleep(2500)`); const { result } = await c.send('Profiler.stop'); const p = result.profile, self = new Map(), byId = new Map(p.nodes.map((n) => [n.id, n])); for (let i = 0; i < p.samples.length; i++) { const n = byId.get(p.samples[i]); const k = n.callFrame.functionName + ' ' + (n.callFrame.url || '').split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + p.timeDeltas[i] / 1000); } console.error([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => v.toFixed(0).padStart(6) + 'ms ' + k).join(String.fromCharCode(10))); }
      const fr = await E(`S.recStop()`), lt = await E(`S.sum(S.lt)`), pos1 = await E(`S.view().yn.get('m0').get('x')`), tm = await E(`S.tstat()`);
      res[name] = { lite: g.lite, wallMs: wall, moved: pos1 - pos0, frames: fr, lt, timers: tm };
    }
    return res;
  },
  async remote() { // 8: remote peers: 20 updates a second for 10 s, 3 cards changed per update (plus a bigger burst)
    await E(`S.fresh('s_remote')`); await gc(); const n = nArg || 2000;
    await E(`S.addCards(${n},{text:(i)=>S.lorem(200,i)}); S.addEdges(${Math.round(n * 0.75)},{}); S.view().um.clear(); 1`); await E(`S.sleep(1500)`);
    const res = { atK1: await E(`S.remote(20,10,3)`) }; await E(`S.view().fit()`); await E(`S.sleep(2500)`);
    res.atFit = await E(`S.remote(20,10,3)`); res.burst = await E(`S.remote(5,6,60)`); return res;
  },
  async all() { // 6: everything together
    await E(`S.fresh('s_all')`); await gc(); const out = { };
    out.cards = await act(`return S.addCards(3000,{text:(i)=>S.lorem(200,i)})`);
    out.bigmd = await act(`return S.addCards(100,{prefix:'md',h:400,w:420,dx:460,dy:440,cols:10,oy:-6000,text:(i)=>S.bigMd(i)})`);
    await E(`window.__imgs=[]; for(let i=0;i<100;i++) window.__imgs.push(S.noiseImg(i+1,610)); 1`, 580000);
    out.images = await act(`return S.addCards(100,{prefix:'im',h:220,w:260,dx:300,dy:260,cols:10,oy:-9000,text:(i)=>'img '+i,img:(i)=>window.__imgs[i]})`); await E(`window.__imgs=null; 1`);
    out.links = await act(`return S.addEdges(3000,{})`);
    out.ink = await act(`return S.addInk(5000,200)`);
    await E(`S.view().um.clear(); S.view().fit()`); await E('S.sleep(4000)'); await gc(); out.state = await E('S.gcState()'); out.timers = await E('S.tstat()');
    out.panFit = await E(`S.camRun('pan',90,6)`); await E('S.sleep(1500)'); out.zoomFit = await E(`S.camRun('zoom',90)`);
    await E(`(()=>{const v=S.view(); v.cam={x:1500,y:700,k:1}; v.applyCam();})()`); await E('S.sleep(3000)'); out.pan = await E(`S.camRun('pan',90)`); out.oneMove = await act(`const v=S.view(),m=v.yn.get('c5');v.doc.transact(()=>{m.set('x',m.get('x')+10);})`);
    out.remote = await E(`S.remote(20,6,3)`); return out;
  },

  async open() { // time to open a saved board of n cards (default 5000) with links
    await E(`S.fresh('s_open')`); const n = nArg || 5000;
    await E(`S.addCards(${n},{text:(i)=>S.lorem(200,i)}); S.addEdges(${Math.round(n * 0.6)},{}); 1`); await E(`S.sleep(1500)`);
    const saveMs = await E(`(async()=>{const v=S.view(); const t=performance.now(); await v.save(); return Math.round(performance.now()-t)})()`);
    const size = await E(`app.vault.adapter.stat('s_open.board').then(s=>s.size)`);
    await E(`(async()=>{for(const l of app.workspace.getLeavesOfType('basalt-board')) l.detach(); await S.sleep(500); return 1})()`); await gc();
    const open = await E(`(async()=>{const t0=performance.now(); const leaf=app.workspace.getLeaf(true); await leaf.setViewState({type:'basalt-board',state:{path:'s_open.board'},active:true}); const t1=performance.now(); await S.raf(); const t2=performance.now(); const v=S.view(); await S.sleep(2500); return {setStateMs:Math.round(t1-t0), firstFrameMs:Math.round(t2-t0), cards:v.yn.size, dom:S.dom(), heap:S.heap()}})()`);
    return { saveMs, fileBytes: size, open };
  },
  async ink() { // 5: n strokes of 200 points
    await E(`S.fresh('s_ink')`); const n = nArg || 20000; await gc();
    const mk = await act(`return S.addInk(${n},200)`);
    await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()'); const svg = await E(`S.view().inkSvg.childNodes.length`);
    return { mk, state, svgChildren: svg, timers, ...(await cam()) };
  },
};
try { done(await scenarios[scen]()); } catch (e) { done({ error: String((e && e.message) || e) }); }
