// CPU profile of a page expression: node prof.mjs <port> "<expr>" [topN]  -> top self-time functions
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { connect } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const c = await connect(+process.argv[2] || 9333, /index\.html/);
await c.eval(fs.readFileSync(path.join(here, 'harness.js'), 'utf8'));
await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 500 }); await c.send('Profiler.start');
const val = await c.eval(process.argv[3], 300000).catch((e) => 'ERR ' + e.message);
const { result } = await c.send('Profiler.stop'); const p = result.profile; const self = new Map(); const byId = new Map(p.nodes.map((n) => [n.id, n]));
const dt = p.timeDeltas; for (let i = 0; i < p.samples.length; i++) { const n = byId.get(p.samples[i]); const k = n.callFrame.functionName + ' ' + (n.callFrame.url || '').split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + dt[i] / 1000); }
console.log('value', JSON.stringify(val).slice(0, 300)); console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +process.argv[4] || 18).map(([k, v]) => v.toFixed(0).padStart(6) + 'ms ' + k).join('\n'));
c.close(); process.exit(0);
