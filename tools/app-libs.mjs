// Where the third-party code sits in src/app.js. Shared by tools/inherited-stats.mjs and tools/vendor-extract.mjs.
// WEBPACK_GROUPS: [group, licence, module ids]. Found by following the n(ID) requires from the application scope.
// APP_LIBS: [library, licence, startAnchor, endAnchor, afterAnchor?]. A library occupies the top-level items of the application scope from the
// one that starts with startAnchor up to (not including) the one that starts with endAnchor; afterAnchor is for text that occurs twice.
export const WEBPACK_GROUPS = [
  ["crypto-js (core, sha256, hmac, hex)", "MIT", [1126, 3490, 8190, 1928, 5897, 3936]],
  ["ts-ebml (webm/matroska reader) + ebml-block", "MIT", [5416, 9840, 4741, 4635, 8193, 3179, 9547, 5226, 8177, 927, 2877, 5420]],
  ["buffer / events / ieee754 / base64-js / int64-buffer / is-buffer (node polyfills for ts-ebml, vfile)", "MIT / BSD-3-Clause (ieee754)", [4686, 9784, 7947, 5350, 6661, 2660]],
  ["@capacitor/core + async-mutex + secure-storage glue", "MIT", [6043, 3860, 8173, 3357, 9804]],
  ["RateApp web stub (Obsidian-written capacitor plugin, 1 class)", "Obsidian", [1979]],
];

export const APP_LIBS = [
  ["tslib helpers (__extends, __assign, __awaiter, __generator, ...)", "0BSD", "function(e,t){return f=Object.setPrototypeOf||{__proto__:[]}instanceof", "S,x,T,D;Object.create;"],
  ["CodeMirror 6: @codemirror/state + @codemirror/view + text/range/gutter/layer/tooltip/panel parts", "MIT", "[],P=[];function L(e){if(e<768)", '{height:"",paddingTop:"",paddingBottom:"",marginTop:""'],
  ["Lezer (@lezer/common, @lezer/highlight) + @codemirror/language + fold gutter", "MIT", "1024,Su=0,xu=function(e,t){this.from=e,this.to=t}", 'Of((function(e){Rf=e.ipcRenderer.sendSync("is-dev")'],
  ["Lucide icon data (1500+ icons)", "ISC (+ MIT for the Feather-derived icons)", '{"a-arrow-down":[[6,"m14 12 4 4 4-4"]', '{"create-new":"edit",trash:"trash-2"'],
  ["idb (IndexedDB promise wrapper)", "ISC", "(e,t)=>t.some((t=>e instanceof t));let qw,jw;", 'function Mk(e){var t=document.createElementNS("http://www.w3.org/2000/svg","svg")'],
  ["yaml (eemeli): lexer, parser, composer, document, schema, stringify", "ISC", 'Symbol.for("yaml.alias"),hE=Symbol.for("yaml.document")', "n(9650),Dx=n(6658),Ax=n(1039),Px=n(6859)"],
  ["diff-match-patch (Google)", "Apache-2.0", "function(){function e(){this.diffTimeout=1,", "function mA(e){return xx(e,null,{})}"],
  ["DOMPurify 3.0.1", "Apache-2.0 OR MPL-2.0", "Object.entries,AP=Object.setPrototypeOf,PP=Object.isFrozen", "window.DOMPurify=EL,EL.addHook"],
  ["CodeMirror 6: @codemirror/commands, history, search, comment, closebrackets, goto-line, drawSelection", "MIT", "function(e){var t=e.state,n=t.doc.lineAt(t.selection.main.from),i=WO(e.state,n.from)", 'Gz.registerPostProcessor((function(e,t){var n,i=e.find(".frontmatter")'],
  ["CodeMirror 6: second copy of @codemirror/language (StreamLanguage, parse worker, syntax highlighting)", "MIT", "function(){function e(e,t,n,i){void 0===n&&(n=[]),void 0===i&&(i=\"\"),this.data=e", "QW.addGlobal(new(function(e){", "window.DOMPurify=EL,EL.addHook"],
  ["CodeMirror 6: @codemirror/autocomplete + snippets + closebrackets", "MIT", "function JW(e){var t=e.map((function(e){return\"string\"==typeof e?{label:e}", "function(){function e(e,t,n,i,r,o,a,s,l,c,u){void 0===c&&(c=0),this.p=e,this.stack=t"],
  ["@lezer/lr (parser runtime)", "MIT", "function(){function e(e,t,n,i,r,o,a,s,l,c,u){void 0===c&&(c=0),this.p=e,this.stack=t", "CK.deserialize({version:14"],
  ["CodeMirror 6: @codemirror/lint", "MIT", "function(){function e(e,t,n){this.diagnostics=e,this.panel=t,this.selected=n}", null],
];
