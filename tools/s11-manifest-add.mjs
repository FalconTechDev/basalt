// Append s11 manifest entries without reformatting: inserts JSON fragments at the
// exact array boundaries, matching the file's existing 2/4/6-space style.
import fs from 'node:fs';

const file = 'src-app/manifest.json';
let s = fs.readFileSync(file, 'utf8');

const obj = (o, indent) => {
  const pad = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  const pad3 = ' '.repeat(indent + 4);
  return `${pad}{\n${pad2}${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(`,\n${pad2}`)}\n${pad}}`;
};

function appendToArray(key, items) {
  // find `  "key": [` then its closing `  ],`
  const start = s.indexOf(`  "${key}": [`);
  if (start < 0) throw new Error(`no array ${key}`);
  const close = s.indexOf('\n  ],', start);
  if (close < 0) throw new Error(`no close for ${key}`);
  const frag = items.map((o) => `,\n${obj(o, 4)}`).join('');
  s = s.slice(0, close) + frag + s.slice(close);
}

const entries = [
  { orig: 'gZ', use: 's11TrackWindowFocus' },
  { orig: 'yZ', use: 's11InstallEnhance' },
  { orig: 'bZ', use: 's11AttachElectron' },
  { orig: 'jZ', use: 's11TextLayerOffset' },
  { orig: 'UZ', use: 's11TextLayerNode' },
];
const classes = [
  { orig: 'MZ', use: 's11AudioView' },
  { orig: 'xZ', use: 's11ImageView' },
  { orig: 'XZ', use: 's11VideoView' },
  { orig: 'eJ', use: 's11MediaEmbed' },
  { orig: 'tJ', use: 's11ImageEmbed' },
  { orig: 'nJ', use: 's11AudioEmbed' },
  { orig: 'iJ', use: 's11VideoEmbed' },
  { orig: 'BZ', use: 's11PdfPasswordPrompt' },
  { orig: 'LZ', use: 's11PdfFindBar' },
  { orig: 'OZ', use: 's11PdfLocalization' },
  { orig: 'HZ', use: 's11PdfToolbar' },
  { orig: 'FZ', use: 's11PdfOutlineItem' },
  { orig: 'NZ', use: 's11PdfOutlineTree' },
  { orig: '_Z', use: 's11PdfViewerComponent' },
  { orig: 'GZ', use: 's11PdfLazyViewer' },
  { orig: 'KZ', use: 's11PdfView' },
  { orig: 'YZ', use: 's11PdfEmbedView' },
];
const declarators = [
  { orig: 'EZ', expr: '__basaltOwn.s11ViewTypeAudio', sha1: '2b297080ad056455eb68f1e35358dcb6b17d2a14', originalBytes: 7 },
  { orig: 'SZ', expr: '__basaltOwn.s11ViewTypeImage', sha1: '40bdc6275db02603c661a3da266ef662618d0d91', originalBytes: 7 },
  { orig: 'QZ', expr: '__basaltOwn.s11ViewTypeVideo', sha1: 'b53c54f0a814aab43d7729f68732b181b86b7f3c', originalBytes: 7 },
  { orig: 'TZ', expr: '__basaltOwn.s11PdfViewerConfig', sha1: 'a7484ef7237bbeccb4e394959167515e66280d42', originalBytes: 480 },
  { orig: 'PZ', expr: '__basaltOwn.s11PdfSearchSettingsKey', sha1: 'b99d91d7d4c8886aa2a1efadc01c9b34861069b8', originalBytes: 23 },
  { orig: 'qZ', expr: '__basaltOwn.s11PdfIsThemedKey', sha1: '67b315d406259a4fab51e6886f79128c60675375', originalBytes: 17 },
  { orig: 'DZ', expr: '__basaltOwn.s11PdfStrings()', sha1: '0673e83d5ade9e8f6a006971043194e5d38c0576', originalBytes: 6 },
  { orig: 'AZ', expr: '__basaltOwn.s11SearchStrings()', sha1: 'b4154efdcf48fd241f859327be778a43a9c38620', originalBytes: 17 },
  { orig: 'IZ', expr: '__basaltOwn.s11PdfStrings()', sha1: '0673e83d5ade9e8f6a006971043194e5d38c0576', originalBytes: 6 },
  { orig: 'RZ', expr: '__basaltOwn.s11PdfStrings()', sha1: '0673e83d5ade9e8f6a006971043194e5d38c0576', originalBytes: 6 },
  { orig: 'VZ', expr: '__basaltOwn.s11PdfStrings()', sha1: '0673e83d5ade9e8f6a006971043194e5d38c0576', originalBytes: 6 },
  { orig: 'zZ', expr: '__basaltOwn.s11PdfStrings()', sha1: '0673e83d5ade9e8f6a006971043194e5d38c0576', originalBytes: 6 },
];

appendToArray('entries', entries);
appendToArray('classes', classes);
appendToArray('declarators', declarators);

// envBind: extend the string before its closing quote
const envAdd = 'fZ,cg,Kc,Dc,Ac,xc,JL,eI,dq,iP,NT,AQ,wQ,Qy,kQ,PQ,XL,gJ,vj,BD,dz,Kl,WZ,Mv,kv,Cv,Ic,RT,cc,qp,jp,BH,wb,VH,DT,Pc,Ly,xy,Ny,createSpan,yg,eJ,tJ,nJ,iJ,kZ,wZ,GZ,_Z,HZ,LZ,BZ,NZ,FZ,OZ,YZ,lJ,TJ,DJ,AJ,LJ,OJ,xJ,kJ,EJ,mJ,HJ,zJ,qJ,rJ,oJ,aJ,uJ,hq,tO,nP,Jo,lz,mZ,vZ,pv,VA';
const m = s.match(/"envBind": "([^"]*)"/);
if (!m) throw new Error('no envBind');
const existing = new Set(m[1].split(','));
const add = envAdd.split(',').filter((n) => !existing.has(n) && !existing.has(n.split(':')[0]));
s = s.replace(m[0], `"envBind": "${m[1]}${add.length ? ',' + add.join(',') : ''}"`);

fs.writeFileSync(file, s);
console.log('added envBind names:', add.length);
