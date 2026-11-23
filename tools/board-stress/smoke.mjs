// Functional smoke test of the culled board through real mouse/keyboard input (CDP). usage: node smoke.mjs <port>
// Builds 400 cards + links (culling is on above 120 cards) and checks: full cards near the view, plain rectangles far/zoomed out,
// drag of a full card and of a rectangle, box select, edit + typing, delete + undo, remote update, links follow moved cards.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { connect } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const c = await connect(+process.argv[2] || 9333, /index\.html/);
await c.eval(fs.readFileSync(path.join(here, 'harness.js'), 'utf8'));
const E = (x) => c.eval(x, 120000), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); if (!cond) fails++; };
const mouse = (type, x, y, extra) => c.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra || {}));
const drag = async (x0, y0, x1, y1, steps = 8) => { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 }); await mouse('mousePressed', x0, y0); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await mouse('mouseReleased', x1, y1); await sleep(120); };
const key = async (k, mods) => { await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Delete: 46, Escape: 27 })[k] || 0, modifiers: mods || 0 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, modifiers: mods || 0 }); };

await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await E(`S.fresh('s_smoke')`);
await E(`(()=>{S.addCards(400,{text:(i)=>'card '+i+' '+S.lorem(60,i),cols:20}); S.addEdges(300,{}); const v=S.view(); v.um.stopCapturing(); v.um.clear(); v.cam={x:1500,y:600,k:1}; v.applyCam(); return 1})()`);
await sleep(1500);
const st = await E(`(()=>{const v=S.view(); let full=0, lite=0; for(const e of v.els.values()) e.lite?lite++:full++; return {geo:v.geo.size, els:v.els.size, full, lite, edges:v.edgeEls.size, ro:v.ro, win:[v.root.clientWidth,v.root.clientHeight]}})()`);
ok('culling active: DOM only for a part of 400 cards', st.els < 400 && st.full > 0, st);
ok('cards near the view are full cards', st.full > 5, st);

// pick a full card well inside the view and drag its grip
const pick = () => E(`(()=>{const v=S.view(); const r=v.root.getBoundingClientRect(); for(const [id,e] of v.els){ if(e.lite) continue; const b=e.el.getBoundingClientRect(); if(b.left>r.left+60&&b.right<r.right-60&&b.top>r.top+80&&b.bottom<r.bottom-80){ const gp=e.el.querySelector('.osb-grip').getBoundingClientRect(); return {id, x:gp.left+gp.width/2-20, y:gp.top+gp.height/2, mx:v.yn.get(id).get('x'), my:v.yn.get(id).get('y')}; } } return null; })()`);
let p = await pick(); ok('found a full card to drag', !!p, p);
await drag(p.x, p.y, p.x + 120, p.y + 60);
let after = await E(`(()=>{const v=S.view(), m=v.yn.get(${JSON.stringify(p.id)}), g=v.geo.get(${JSON.stringify(p.id)}), e=v.els.get(${JSON.stringify(p.id)}); return {x:m.get('x'), y:m.get('y'), gx:g.x, left:e.el.style.left, sel:[...v.sel]}})()`);
ok('drag moves the card (model, cache, DOM agree)', Math.abs(after.x - p.mx - 120) < 12 && Math.abs(after.y - p.my - 60) < 12 && after.gx === after.x && after.left === after.x + 'px', { p, after });
const linkOk = await E(`(()=>{const v=S.view(); const id=${JSON.stringify(p.id)}; const es=[...v.eg].filter(([k,r])=>r.a===id||r.b===id); if(!es.length) return 'no-links'; for(const [k,r] of es){ const el=v.edgeEls.get(k); if(el&&r.dirty) return 'stale'; } return 'ok'})()`);
ok('links of the moved card are redrawn (or none attached)', linkOk !== 'stale', linkOk);

// box select on empty space around some cards
await E(`(()=>{const v=S.view(); v.select(new Set()); v.cam={x:1500,y:600,k:1}; v.applyCam();})()`); await sleep(400);
const gap = await E(`(()=>{const r=S.view().root.getBoundingClientRect(); for(let y=r.top+120;y<r.bottom-300;y+=7) for(let x=r.left+120;x<r.right-420;x+=7){ const t=document.elementFromPoint(x,y); if(t&&t.closest('.osb-root')&&!t.closest('.osb-card,.osb-rail,.osb-bar,.osb-mini,.osb-bottom,.osb-sel,.osb-search,g')) return [x,y]; } return null})()`);
await drag(gap[0], gap[1], gap[0] + 420, gap[1] + 280, 6);
const sel = await E(`S.view().sel.size`); ok('box select selects cards', sel > 0, sel);

// delete + undo
await E(`S.view().contentEl.focus()`); const n0 = await E(`S.view().yn.size`);
await key('Delete'); await sleep(300); const n1 = await E(`S.view().yn.size`); ok('Delete removes selected cards', n1 < n0, [n0, n1]);
await E(`S.view().undo()`); await sleep(400); const n2 = await E(`S.view().yn.size`); ok('undo restores them', n2 === n0, [n1, n2]);
const domOk = await E(`(()=>{const v=S.view(); let bad=0; for(const [id,e] of v.els){ if(!v.yn.get(id)) bad++; if(!e.el.isConnected) bad++; } for(const id of v.yn.keys()) if(!v.geo.has(id)) bad++; return bad})()`); ok('no orphan nodes, geo cache complete', domOk === 0, domOk);

// edit: double click on a full card, type
await E(`(()=>{const v=S.view(); v.select(new Set()); v.cam={x:1500,y:600,k:1}; v.applyCam();})()`); await sleep(500);
p = await pick(); const tb = await E(`(()=>{const e=S.view().els.get(${JSON.stringify(p.id)}); const b=e.el.querySelector('.osb-md').getBoundingClientRect(); return [b.left+b.width/2,b.top+b.height/2]})()`);
await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tb[0], y: tb[1] }); await mouse('mousePressed', tb[0], tb[1], { clickCount: 1 }); await mouse('mouseReleased', tb[0], tb[1], { clickCount: 1 }); await mouse('mousePressed', tb[0], tb[1], { clickCount: 2 }); await mouse('mouseReleased', tb[0], tb[1], { clickCount: 2 }); await sleep(300);
const ed = await E(`(()=>{const e=S.view().els.get(${JSON.stringify(p.id)}); return {editing:e.el.classList.contains('is-editing'), focus:document.activeElement===e.ta}})()`); ok('double click starts editing', ed.editing && ed.focus, ed);
await c.send('Input.insertText', { text: 'ZZTYPED' }); await sleep(200);
const txt = await E(`S.view().yn.get(${JSON.stringify(p.id)}).get('text').toString()`); ok('typing reaches the CRDT', txt.includes('ZZTYPED'), txt.slice(0, 60));
await E(`S.view().els.get(${JSON.stringify(p.id)}).ta.blur()`); await sleep(100);

// zoom out below the rectangle threshold: everything plain, still draggable
await E(`(()=>{const v=S.view(); v.cam={x:1500,y:600,k:0.2}; v.applyCam();})()`); await sleep(1200);
const lod = await E(`(()=>{const v=S.view(); let full=0, lite=0; for(const e of v.els.values()) e.lite?lite++:full++; return {full,lite,edgeFull:[...v.edgeEls.values()].filter(e=>!e.lite).length}})()`);
ok('zoomed out: only rectangles', lod.full === 0 && lod.lite > 100, lod);
const lp = await E(`(()=>{const v=S.view(); const r=v.root.getBoundingClientRect(); for(const [id,e] of v.els){ const b=e.el.getBoundingClientRect(); if(b.left>r.left+80&&b.right<r.right-80&&b.top>r.top+100&&b.bottom<r.bottom-100) return {id,x:b.left+b.width/2,y:b.top+b.height/2,mx:v.yn.get(id).get('x')}; } return null})()`);
await drag(lp.x, lp.y, lp.x + 60, lp.y + 20);
const lx = await E(`S.view().yn.get(${JSON.stringify(lp.id)}).get('x')`); ok('a plain rectangle can be dragged', lx > lp.mx + 100, [lp.mx, lx]);
// back in: rectangles become full cards
await E(`(()=>{const v=S.view(); v.cam={x:1500,y:600,k:1}; v.applyCam();})()`); await sleep(1500);
const back = await E(`(()=>{const v=S.view(); let full=0; for(const e of v.els.values()) if(!e.lite) full++; return full})()`); ok('zoomed in again: full cards return', back > 5, back);

// remote update (second doc) reaches DOM
const rem = await E(`(async()=>{const v=S.view(), y=window.__bsY.Y, d2=new y.Doc(); y.applyUpdate(d2, y.encodeStateAsUpdate(v.doc)); d2.on('update',(u)=>y.applyUpdate(v.doc,u,'remote')); const id=[...v.els].find(([k,e])=>!e.lite)[0]; d2.getMap('nodes').get(id).get('text').insert(0,'REMOTE '); await S.sleep(300); const e=v.els.get(id); return {md:e.mdEl.textContent.slice(0,30), ta:e.ta.value.slice(0,20)}})()`);
ok('remote edit shows in the card', /REMOTE/.test(rem.md) && /REMOTE/.test(rem.ta), rem);
// search jump to a far card materialises it
const sj = await E(`(async()=>{const v=S.view(); v.toggleSearch(true); v.searchInput.value='card 399 '; v.runSearch(0,true); await S.sleep(600); const id=v._hits[0]; return {hits:v._hits.length, has:!!v.els.get(id), hit:v.els.get(id)&&v.els.get(id).el.classList.contains('is-hit')}})()`);
ok('search finds and shows a far card', sj.hits >= 1 && sj.has && sj.hit, sj);
await E(`S.view().toggleSearch(false)`);
console.log(JSON.stringify({ exceptions: c.events.exceptions.slice(0, 5), crashed: c.events.crashed, errlogs: c.events.logs.slice(0, 3) }));
console.log(fails ? 'FAILED ' + fails : 'ALL PASSED');
await c.send('Emulation.clearDeviceMetricsOverride'); c.close(); process.exit(fails ? 1 : 0);
