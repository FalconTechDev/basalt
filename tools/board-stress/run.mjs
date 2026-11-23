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
  async ink() { // 5: n strokes of 200 points
    await E(`S.fresh('s_ink')`); const n = nArg || 20000; await gc();
    const mk = await act(`return S.addInk(${n},200)`);
    await gc(); const state = await E('S.gcState()'); const timers = await E('S.tstat()'); const svg = await E(`S.view().inkSvg.childNodes.length`);
    return { mk, state, svgChildren: svg, timers, ...(await cam()) };
  },
};
try { done(await scenarios[scen]()); } catch (e) { done({ error: String((e && e.message) || e) }); }
