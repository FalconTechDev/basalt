// opens (creating) a .board in the scratch vault and prints view info
import { connect } from './cdp.mjs';
const c = await connect(+process.argv[2] || 9333, /index\.html/);
console.log(await c.eval(`(async()=>{
  const p='stress.board'; let f=app.vault.getAbstractFileByPath(p); if(!f) f=await app.vault.create(p,'');
  const leaf=app.workspace.getLeaf(true); await leaf.setViewState({type:'basalt-board',state:{path:p},active:true});
  await new Promise(r=>setTimeout(r,1500));
  const v=app.workspace.getLeavesOfType('basalt-board').map(l=>l.view)[0];
  return JSON.stringify({ok:!!v, n:v&&v.yn&&v.yn.size, win:[innerWidth,innerHeight], hidden:document.hidden, vis:document.visibilityState});
})()`));
console.log(JSON.stringify(c.events));
c.close(); process.exit(0);
