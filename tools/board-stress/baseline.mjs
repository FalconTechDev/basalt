// Serve an OLD basalt-board.js to the running app (no file is touched) and reload, to measure "before" numbers:
//   node baseline.mjs <port> <path-to-old-basalt-board.js>      then run the usual scripts with BS_KEEP=1 ... see README
// Stays alive holding the interception; kill it (Ctrl+C / taskkill its PID) when done, then run `node reload.mjs <port>` to return to the current code.
import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(+process.argv[2] || 9333, /index\.html/);
const body = Buffer.from(fs.readFileSync(process.argv[3], 'utf8'), 'utf8').toString('base64');
await c.send('Fetch.enable', { patterns: [{ urlPattern: '*basalt-board.js*' }] });
c.onEvent((d) => { if (d.method === 'Fetch.requestPaused') { c.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body }); console.log('served old board for', d.params.request.url); } });
await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true }); await c.send('Page.enable'); await c.send('Page.reload', { ignoreCache: true });
console.log('baseline active; Ctrl+C to stop'); setInterval(() => {}, 1e6);
