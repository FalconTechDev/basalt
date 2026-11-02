// Builds the wasm engine and bakes it into src/fp-canvas.js; patches app.js hooks + index.html (idempotent).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandApp } from "./brand.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const eng = path.join(root, "canvas-engine");
const src = path.join(root, "src");
const target = process.env.CARGO_TARGET_DIR || path.join(eng, "target");

if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release --target wasm32-unknown-unknown", {
    cwd: eng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target },
  });
}
const wasm = fs.readFileSync(path.join(target, "wasm32-unknown-unknown/release/canvas_engine.wasm"));
const js = fs.readFileSync(path.join(eng, "fp-canvas.src.js"), "utf8").replace("__WASM_B64__", wasm.toString("base64"));
fs.writeFileSync(path.join(src, "fp-canvas.js"), js);

// the command-line client for the local API -> src/bin/
const cli = path.join(root, "cli");
const ctarget = process.env.CLI_TARGET_DIR || (process.env.CARGO_TARGET_DIR ? path.join(path.dirname(process.env.CARGO_TARGET_DIR), "basalt-cli") : path.join(cli, "target"));
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release", { cwd: cli, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: ctarget } });
}
const cexe = path.join(ctarget, "release", process.platform === "win32" ? "basalt-cli.exe" : "basalt-cli");
try { if (fs.existsSync(cexe)) { fs.mkdirSync(path.join(src, "bin"), { recursive: true }); fs.copyFileSync(cexe, path.join(src, "bin", path.basename(cexe))); } } catch (e) { console.warn('cli copy skipped (file in use):', e.code); }
try { if (fs.existsSync(cexe)) fs.copyFileSync(cexe, path.join(src, "bin", process.platform === "win32" ? "basalt.exe" : "basalt")); } catch (e) { console.warn('cli copy skipped (file in use):', e.code); }
try { if (fs.existsSync(path.join(root, "runtime", "Basalt.exe")) && fs.existsSync(cexe)) fs.copyFileSync(cexe, path.join(root, "runtime", "Basalt.com")); if (fs.existsSync(path.join(root, "runtime", "Basalt.exe")) && fs.existsSync(cexe)) fs.copyFileSync(cexe, path.join(root, "runtime", "basalt-cli.exe")); } catch (e) { console.warn('cli copy skipped (file in use):', e.code); }

// the pty helper for the terminal (a native exe) -> src/bin/
const pty = path.join(root, "pty-helper");
const ptarget = process.env.PTY_TARGET_DIR || (process.env.CARGO_TARGET_DIR ? path.join(path.dirname(process.env.CARGO_TARGET_DIR), "basalt-pty") : path.join(pty, "target"));
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release", { cwd: pty, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: ptarget } });
}
const exe = path.join(ptarget, "release", process.platform === "win32" ? "basalt-pty.exe" : "basalt-pty");
if (fs.existsSync(exe)) { fs.mkdirSync(path.join(src, "bin"), { recursive: true }); fs.copyFileSync(exe, path.join(src, "bin", path.basename(exe))); }

// the note search (Rust/WASM index) -> src/basalt-search.js
const seng = path.join(root, "search-engine");
const starget = process.env.SEARCH_TARGET_DIR || (process.env.CARGO_TARGET_DIR ? path.join(path.dirname(process.env.CARGO_TARGET_DIR), "search-engine") : path.join(seng, "target"));
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release --target wasm32-unknown-unknown", { cwd: seng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: starget } });
}
const swasm = fs.readFileSync(path.join(starget, "wasm32-unknown-unknown/release/search_engine.wasm"));
fs.writeFileSync(path.join(src, "basalt-search.js"), fs.readFileSync(path.join(seng, "basalt-search.src.js"), "utf8").replace("__WASM_B64__", swasm.toString("base64")));

// the vault graph: falconplot's engine (graph-engine, WASM) plus the view, baked into src/fp-graph.js
const geng = path.join(root, "graph-engine"), gtarget = process.env.GRAPH_TARGET_DIR || "E:/rust-target/graph-engine";
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release --target wasm32-unknown-unknown", { cwd: geng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: gtarget } });
}
const gwasm = fs.readFileSync(path.join(gtarget, "wasm32-unknown-unknown/release/graph_engine.wasm"));
fs.writeFileSync(path.join(src, "fp-graph.js"), fs.readFileSync(path.join(geng, "fp-graph.src.js"), "utf8").replace("__WASM_B64__", gwasm.toString("base64")));

const appPath = path.join(src, "app.js");
const orig = path.join(src, "app.js.orig");
if (!fs.existsSync(orig)) fs.copyFileSync(appPath, orig);
let app = fs.readFileSync(orig, "utf8");
const patch = (from, to) => {
  if (app.split(from).length !== 2) throw new Error("hook anchor not unique/found: " + from.slice(0, 60));
  app = app.replace(from, () => to);
};
patch('prototype.showMenu=function(e){var t=this,n=this.canvas;n.readonly||e.addItem((function(e){return e.setSection("danger")',
  'prototype.showMenu=function(e){var t=this,n=this.canvas;window.__fpNodeMenu&&window.__fpNodeMenu(e,t);n.readonly||e.addItem((function(e){return e.setSection("danger")');
patch('var k=Rb(Fb(["Shift"],"2"));if(b(s,j3.actionZoomToSelection()',
  'var k=Rb(Fb(["Shift"],"2"));window.__fpToolbar&&window.__fpToolbar(s,c,r);if(b(s,j3.actionZoomToSelection()');
patch('t.prototype.showVersionHistory=function(e){return y(this,void 0,void 0,(function(){return b(this,(function(t){return new I9(this.app,this,e).open(),[2]}))}))}',
  't.prototype.showVersionHistory=function(e){if(window.__vaultSyncHistory)return window.__vaultSyncHistory(e);return y(this,void 0,void 0,(function(){return b(this,(function(t){return new I9(this.app,this,e).open(),[2]}))}))}');
patch('e.prototype.createEdgeEnd=function(e){return"arrow"===e?',
  'e.prototype.createEdgeEnd=function(e){var fp=window.__fpEndPoints&&window.__fpEndPoints(e);if(fp)return{el:this.lineEndGroupEl.createSvg("g",{},(function(g){g.createSvg("polygon",{cls:"canvas-path-end",attr:{points:fp}})})),type:e};return"arrow"===e?');
patch('e.prototype.showMenu=function(e,t){var n=this;this.canvas.readonly||(e.addItem((function(e){return e.setSection("danger").setTitle(B5.actionRemove())',
  'e.prototype.showMenu=function(e,t){var n=this;window.__fpEdgeMenu&&window.__fpEdgeMenu(e,n);this.canvas.readonly||(e.addItem((function(e){return e.setSection("danger").setTitle(B5.actionRemove())');
patch('canvas-card-menu",(function(e){e.createDiv({cls:"canvas-card-menu-button mod-draggable"}',
  'canvas-card-menu",(function(e){setTimeout((function(){window.__fpCardMenu&&window.__fpCardMenu(e,t)}),0);e.createDiv({cls:"canvas-card-menu-button mod-draggable"}');
patch('u=this.bezier=j5(s,t.side,c,n.side);',
  'u=this.bezier=j5(s,t.side,c,n.side),fpx=window.__fpBezierFix&&window.__fpBezierFix(this,u,s,c,t.side,n.side);');
// the "add by card type" entry goes right after "add card", the way people expect it
patch('i.createTextNode({pos:t,size:n})}))})).addItem((function(e){e.setTitle(c5.actionAddNote())',
  'i.createTextNode({pos:t,size:n})}))})),window.__fpCreationMenu&&window.__fpCreationMenu(e,i,t,n),e.addItem((function(e){e.setTitle(c5.actionAddNote())');patch('createLinkNode=function(e){var t=e.pos,n=e.size,i=e.position,r=e.url,', 'createLinkNode=function(e){var t=e.pos,n=e.size,i=e.position,r=window.__fpUrl?window.__fpUrl(e.url):e.url,');
patch('setUrl=function(e){this.url!==e&&', 'setUrl=function(e){e=window.__fpUrl?window.__fpUrl(e):e;this.url!==e&&');
patch('e.prototype.onConnectionPointerdown=function(e){var t=this,n=this.canvas;e.isPrimary&&0===e.button&&',
  'e.prototype.onConnectionPointerdown=function(e){var t=this,n=this.canvas;if(window.__fpEdgeGrab&&window.__fpEdgeGrab(this,e))return;e.isPrimary&&0===e.button&&');
patch('.concat(-c,"px)");var D=t.gridSpacing;', '.concat(-c,"px)"),window.__fpView&&window.__fpView(t,l,c,m,x,T);var D=t.gridSpacing;');
patch("P.clear(),t.nodeInteractionLayer.render()", "window.__fpFrame&&window.__fpFrame(t,te),P.clear(),t.nodeInteractionLayer.render()");
patch('s(),l(a.zoomBreakpoint||0)},t}(Y0)', 's(),l(a.zoomBreakpoint||0),window.__fpSettings&&window.__fpSettings(t,a,e.plugin,e.instance,zk)},t}(Y0)');
// File explorer (and the other trees): Ctrl/Cmd+click toggles an item in the selection, like a file manager,
// and Ctrl+Shift+click extends the range. Stock only does Alt+click here and uses Ctrl+click to open a new tab.
patch(
  'e.prototype.handleItemSelection=function(e,t){var n=this,i=n.selectedDoms,r=n.activeDom,o=n.view;if(!Bg.isModEvent(e)){',
  'e.prototype.handleItemSelection=function(e,t){var n=this,i=n.selectedDoms,r=n.activeDom,o=n.view;' +
  'if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.instanceOf(MouseEvent)){this.app.workspace.setActiveLeaf(o.leaf,{focus:!0});' +
  'if(e.shiftKey){for(var a0=0,s0=r?KH(r,t):[t];a0<s0.length;a0++)this.selectItem(s0[a0]);return!0}' +
  'if(i.has(t))this.deselectItem(t);else{this.activeDom&&this.selectItem(this.activeDom),this.selectItem(t),this.setFocusedItem(t,!1),this.activeDom=t}return!0}' +
  'if(!Bg.isModEvent(e)){'
);
// the classes our own views are built on, for scripts outside the bundle
patch('this.cli=new CA(this),o.addClass("obsidian-app")', 'window.__bsApi={ItemView:Yg,Modal:tb,Notice:fb,Menu:Ug,setIcon:tv},this.cli=new CA(this),o.addClass("obsidian-app")');
// Basalt keeps its own settings folder (.basalt) so changing the theme or plugins in Obsidian never touches it. On the first
// open of a vault the Obsidian folder is copied over once.
patch('var YT=".obsidian",', 'var YT=".basalt",');
patch('t.prototype.setupConfig=function(){', 't.prototype.setupConfig=function(){(function(v){try{var fs=window.require("fs"),pa=window.require("path"),b=v.adapter.basePath,o=pa.join(b,".obsidian"),n=pa.join(b,".basalt");function cp(a,c){fs.mkdirSync(c,{recursive:!0});fs.readdirSync(a,{withFileTypes:!0}).forEach(function(e){var s=pa.join(a,e.name),d=pa.join(c,e.name);e.isDirectory()?cp(s,d):fs.copyFileSync(s,d)})}if(b&&!fs.existsSync(n)&&fs.existsSync(o))cp(o,n)}catch(x){console.error("[basalt] settings copy failed",x)}})(this);');
// PNG export: sharper by default (2x, up to 4x on the slider) - the stock default was 1x
patch('h=Math.min(2,16284/s/c,16284/s/u),p="",d=Math.min(1,h)', 'h=Math.min(4,16284/s/c,16284/s/u),p="",d=Math.min(2,h)');
// PNG export: the titles above cards stick out of the cards: the frame takes them in, like it does for a card that does not fit
patch('l=y3(g3(Array.from(this.nodes.values()).map(m3)),100),c=l.maxX-l.minX', 'l=y3(g3(Array.from(this.nodes.values()).map(m3)),100+160/Math.max(.15,this.scale)),c=l.maxX-l.minX');
app = brandApp(app);
fs.writeFileSync(appPath, app);

const htmlPath = path.join(src, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("fp-canvas.js")) {
  html = html.replace('<script type="text/javascript" defer src="app.js"></script>', '<script type="text/javascript" defer src="fp-canvas.js"></script>\n<script type="text/javascript" defer src="app.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("vault-sync.js")) {
  html = html.replace('<script type="text/javascript" defer src="app.js"></script>', '<script type="text/javascript" defer src="app.js"></script>\n<script type="text/javascript" defer src="vault-sync.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
for (const page of ["index.html", "starter.html", "help.html"]) {
  const f = path.join(src, page);
  let h2 = fs.readFileSync(f, "utf8");
  if (!h2.includes("basalt-ui.js")) {
    h2 = h2.replace("</head>", '<script type="text/javascript" defer src="basalt-ui.js"></script>\n</head>');
    fs.writeFileSync(f, h2);
  }
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-code.js")) {
  html = html.replace('<script type="text/javascript" defer src="vault-sync.js"></script>', '<script type="text/javascript" defer src="vault-sync.js"></script>\n<script type="text/javascript" defer src="basalt-code.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("fp-graph.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-code.js"></script>', '<script type="text/javascript" defer src="basalt-code.js"></script>\n<script type="text/javascript" defer src="fp-graph.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-term.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-code.js"></script>', '<script type="text/javascript" defer src="basalt-code.js"></script>\n<script type="text/javascript" defer src="basalt-term.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-search.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-code.js"></script>', '<script type="text/javascript" defer src="basalt-code.js"></script>\n<script type="text/javascript" defer src="basalt-search.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-extras.js")) {
  html = html.replace('<script type="text/javascript" defer src="fp-graph.js"></script>', '<script type="text/javascript" defer src="fp-graph.js"></script>\n<script type="text/javascript" defer src="basalt-extras.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-home.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-extras.js"></script>', '<script type="text/javascript" defer src="basalt-extras.js"></script>\n<script type="text/javascript" defer src="basalt-home.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-pins.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-home.js"></script>', '<script type="text/javascript" defer src="basalt-home.js"></script>\n<script type="text/javascript" defer src="basalt-pins.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("basalt-api.js")) {
  html = html.replace('<script type="text/javascript" defer src="basalt-pins.js"></script>', '<script type="text/javascript" defer src="basalt-pins.js"></script>\n<script type="text/javascript" defer src="basalt-api.js"></script>');
  fs.writeFileSync(htmlPath, html);
}
html = fs.readFileSync(htmlPath, "utf8");
for (const [file, after] of [["basalt-wasm.js", "basalt-api.js"], ["basalt-catalog.js", "basalt-wasm.js"], ["basalt-files.js", "basalt-pins.js"], ["basalt-tabs.js", "basalt-files.js"], ["basalt-palette.js", "basalt-tabs.js"], ["basalt-draw.js", "basalt-palette.js"], ["basalt-settings.js", "basalt-draw.js"], ["basalt-update.js", "basalt-settings.js"], ["basalt-viewer.js", "basalt-update.js"], ["basalt-minifeatures.js", "basalt-viewer.js"]]) {
  if (!html.includes(file)) {
    const a = `<script type="text/javascript" defer src="${after}"></script>`;
    html = html.replace(a, a + "\n" + `<script type="text/javascript" defer src="${file}"></script>`);
    fs.writeFileSync(htmlPath, html);
  }
}
console.log("fp-canvas built:", (wasm.length / 1024).toFixed(0), "KB wasm");
