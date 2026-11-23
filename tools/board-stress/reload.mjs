// hard reload of the vault window (bypasses the script cache) so edited src files are picked up: node reload.mjs <port>
import { connect } from './cdp.mjs';
const c = await connect(+process.argv[2] || 9333, /index\.html/);
await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
await c.send('Page.enable'); await c.send('Page.reload', { ignoreCache: true });
c.close(); await new Promise((r) => setTimeout(r, 1000));
const c2 = await connect(+process.argv[2] || 9333, /index\.html/);
for (let i = 0; i < 60; i++) { try { if (await c2.eval("typeof app !== 'undefined' && !!app.workspace && !!window.__bsY && !!window.__bsShareReady")) break; } catch (e) { /* loading */ } await new Promise((r) => setTimeout(r, 500)); }
console.log('reloaded', await c2.eval("document.querySelector('script[src*=\"basalt-board\"]') ? 'ok' : 'no-script'"));
c2.close(); process.exit(0);
