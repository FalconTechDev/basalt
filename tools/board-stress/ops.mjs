// Operation scenarios on a mid-heavy board. usage: node ops.mjs <port> <tag> [cards] [only,step,names]
// board: N cards (200 chars), ~0.75N links, 300 ink strokes. Each step is timed (ms until the call returns + ms until the next painted frame) and long tasks are counted.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { connect } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const port = +process.argv[2] || 9333, tag = process.argv[3] || 'run', N = +process.argv[4] || 2000, only = process.argv[5] ? process.argv[5].split(',') : null;
const c = await connect(port, /index\.html/);
await c.send('HeapProfiler.enable');
await c.eval(fs.readFileSync(path.join(here, 'harness.js'), 'utf8'));
const E = (x, t) => c.eval(x, t || 90000).catch((e) => { throw e; });
const gc = () => c.send('HeapProfiler.collectGarbage');
const res = { scen: 'ops', n: N, tag, t: new Date().toISOString(), steps: {} };
let lastOk = true;
const act = async (name, code, to) => {
  if (only && !only.includes(name)) return;
  if (/^undo_/.test(name) && !lastOk) { res.steps[name] = { skipped: true }; return; }
  try { res.steps[name] = await E(`S.timeAct(async()=>{${code}}).then(r=>({ms:r.ms,paintMs:r.paintMs,lt:r.lt.max||0,r:r.r}))`, to); }
  catch (e) { res.steps[name] = { error: String(e.message || e).slice(0, 160) }; }
  lastOk = !res.steps[name].error; console.log(name, JSON.stringify(res.steps[name]));
};
await E(`S.fresh('s_ops')`);
await E(`(()=>{S.addCards(${N},{text:(i)=>S.lorem(200,i)}); const v=S.view(); v.doc.transact(()=>{let i=0; for(const m of v.yn.values()){ if(i%2) m.set('kind','Человек'); else m.set('kind','Организация'); i++; }}); S.addEdges(${Math.round(N * 0.75)},{}); S.addInk(300,50,{span:6000}); return 1;})()`, 300000);
await E(`S.view().um.stopCapturing(); S.view().um.clear()`); await E('S.raf()'); await E(`S.view().fit()`); await E('S.raf()'); await E('S.clearStats()');
await gc(); res.heap0 = await E('S.heap()'); res.dom0 = await E('S.dom()');
await act('fit', `S.view().fit()`);
await act('minimap', `S.view().paintMini()`);
await act('search_many', `const v=S.view(); v.toggleSearch(true); v.searchInput.value='alpha'; v.runSearch(0,true); return v._hits.length`);
await act('search_none', `const v=S.view(); v.searchInput.value='zzzqq'; v.runSearch(0,true); return v._hits.length`);
await act('search_close', `S.view().toggleSearch(false)`);
await act('select_all', `const v=S.view(); v.select(new Set(v.yn.keys()))`);
await act('arrow_move_all', `const v=S.view(); v.doc.transact(()=>{for(const id of v.sel){const m=v.yn.get(id); m.set('x',m.get('x')+10); m.set('y',m.get('y')+10);}})`);
await act('deselect', `const v=S.view(); v.select(new Set())`);
await act('tidy_cells', `S.view().tidy('cells',null); await S.sleep(50)`, 60000);
await act('undo_tidy', `S.view().undo()`);
await act('redo_tidy', `S.view().redo()`);
await act('layout_auto', `S.view().layout('auto')`, 60000);
await act('undo_layout', `S.view().undo()`);
await act('layout_lr', `S.view().layout('lr')`, 60000);
await act('undo_layout2', `S.view().undo()`);
await act('layout_td', `S.view().layout('td')`, 60000);
await act('undo_layout3', `S.view().undo()`);
await act('layout_radial', `S.view().layout('radial')`, 60000);
await act('undo_layout4', `S.view().undo()`);
await act('layout_force', `S.view().layout('force')`, 60000);
await act('undo_layout5', `S.view().undo()`);
await act('layout_typed', `S.view().layoutTyped({dir:'lr',gap:'normal',levels:[['Человек'],['Организация']],name:'t'})`, 60000);
await act('undo_typed', `S.view().undo()`);
await act('export_png', `const cv=await S.view().renderExport({bg:'white',scale:2,pad:40}); const b=await new Promise(r=>cv.toBlob(r,'image/png')); return [cv.width,cv.height,b.size]`, 90000);
await act('save', `await S.view().save()`, 60000);
await act('snapshot', `return await S.view().snapshot(true)`, 60000);
await act('paste_200_lines', `const v=S.view(); const lines=[]; for(let i=0;i<200;i++) lines.push('pasted line '+i); const w=v.worldPt(300,300); if(v.pasteLines){ v.pasteLines(lines,w); } else { const cols=5; lines.forEach((ln,k)=>v.addCard(w.x+(k%cols)*290,w.y+Math.floor(k/cols)*140,ln)); } return v.yn.size`, 60000);
await act('undo_paste', `S.view().undo()`);
await act('open_reload', `const v=S.view(); await v.save(); const p=v.path; for(const l of app.workspace.getLeavesOfType('basalt-board')) l.detach(); await S.sleep(300); const t0=performance.now(); const leaf=app.workspace.getLeaf(true); await leaf.setViewState({type:'basalt-board',state:{path:p},active:true}); const v2=S.view(); S.wrap(v2); return Math.round(performance.now()-t0)`, 90000);
await act('import_5000', `const v=S.view(); const Y=window.__bsY.Y; const d=new Y.Doc(); const nn=d.getMap('nodes'), ee=d.getMap('edges'); d.transact(()=>{for(let i=0;i<5000;i++){const m=new Y.Map(),t=new Y.Text(); t.insert(0,S.lorem(200,i)); m.set('x',(i%80)*300); m.set('y',Math.floor(i/80)*150); m.set('w',260); m.set('h',110); m.set('color',''); m.set('text',t); nn.set('n'+i,m);} for(let i=1;i<4000;i++){const m=new Y.Map(); m.set('a','n'+(i-1)); m.set('b','n'+i); m.set('label',''); ee.set('e'+i,m);}}); const text=JSON.stringify({v:2,ydoc:btoa(String.fromCharCode.apply(null,Y.encodeStateAsUpdate(d).subarray(0,0)))}); const full=Y.encodeStateAsUpdate(d); let s=''; for(let i=0;i<full.length;i+=32768) s+=String.fromCharCode.apply(null,full.subarray(i,i+32768)); const txt=JSON.stringify({v:2,ydoc:btoa(s)}); const t0=performance.now(); const data=v.readBoardDoc(txt); const tr=performance.now()-t0; v.importBoardData(data,new Set(data.nodes.map(q=>q.id)),null,true); return {readMs:Math.round(tr),n:v.yn.size}`, 240000);
await act('undo_import', `S.view().undo()`);
await act('select_all_delete', `const v=S.view(); v.select(new Set(v.yn.keys())); v.removeSel(); return v.yn.size`, 60000);
await act('undo_delete', `S.view().undo()`, 60000);
await gc(); res.heap1 = await E('S.heap()'); res.dom1 = await E('S.dom()');
res.exc = c.events.exceptions.slice(0, 6); res.crashed = c.events.crashed; res.errlogs = c.events.logs.slice(0, 4);
fs.appendFileSync(path.join(here, 'results.jsonl'), JSON.stringify(res) + '\n'); console.log('heap', res.heap0, res.heap1, 'dom', res.dom0, res.dom1, 'exc', res.exc.length, 'crashed', res.crashed);
c.close(); process.exit(0);
