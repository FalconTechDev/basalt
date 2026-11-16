import { loadBase } from "./app-base.mjs";
const base = loadBase("ca5acac");
const names = ["Sg","j3","q3","Vk","R3","Tc","Av","eJ","CZ","lJ","YZ","RI","mA","Zw","ag","lg","Dl","Uv","AI","u3","KA","TT","xT","B3","H3","j5","H5","w3","m3","g3","y3","b3","Pc","M$","RX","Ec","nu","Pf","ub","su","iu","gm","Yl","UT","qT","$T","cc","createSvg","createDiv","tv","Mv","Bg","Ug","nb","fb","qk","zk","Wk","Gk","AI","E5","L5","x3","N5","sJ","O5","F5","I5","T5","S5","A5","x5","K5","D3","T3","Q5","i8","l5","n8","M5","t8","e8","r8","BX","Y0","tb","SI","jm","Ng","y5","M8","C8","E8","T9","g1","d1","m1","Z5","$5","x8","d8","L8","I8","f8","w8","A8","k5","C5","B5","Y5","J5","U5","W5","_5","G5","P5","R5","X5","a8","N8","s8","F8","O8","b8","R8","o8","V5","z5","b5","m8","g8"];
for (const name of names) {
  const t = base.fn(name);
  if (t) { console.log("### " + name + " (" + t.length + ")"); console.log(t.slice(0, 300)); continue; }
  // try var declarator
  const re = new RegExp("[,;{ ]" + name.replace(/[$]/g, "\\$") + "=", "g");
  const m = re.exec(base.src);
  if (m) console.log("@@@ " + name + " var @" + m.index + " " + JSON.stringify(base.src.slice(m.index, m.index + 200)));
  else console.log("??? " + name);
}
