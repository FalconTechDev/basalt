import {loadBase} from './app-base.mjs';
const base=loadBase('ca5acac');
const src=base.src;
for(const w of process.argv.slice(2)){
  const re=new RegExp('(^|[^A-Za-z0-9_$])'+w.replace(/\$/g,'\$')+'([^A-Za-z0-9_$]|$)','g');
  let m,c=0; const ctx=[];
  while((m=re.exec(src))&&c<8){ctx.push(src.slice(Math.max(0,m.index-60),m.index+80).replace(/\n/g,' '));c++}
  console.log('### '+w+' ('+c+')'); ctx.forEach(x=>console.log('  '+x));
}
