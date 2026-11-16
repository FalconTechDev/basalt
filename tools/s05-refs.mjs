import {loadBase} from './app-base.mjs';
const base=loadBase('ca5acac');
const src=base.src;
for(const name of process.argv.slice(2)){
  const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp('\\b'+esc+'\\b','g');
  const hits=[];let m;
  while((m=re.exec(src))&&hits.length<40){hits.push(src.slice(Math.max(0,m.index-70),m.index+90).replace(/\n/g,' '));}
  console.log('=== '+name+' ('+hits.length+')');
  hits.slice(0,15).forEach(h=>console.log('  ...'+h+'...'));
}
