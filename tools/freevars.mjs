// Scratch analysis: free (unbound) names of a top-level var/function in the base bundle.
//   node tools/freevars.mjs <name> [name...]     prints free identifiers grouped by what they resolve to
import { loadBase } from "./app-base.mjs";
import { loadBundle, acorn } from "./split-app.mjs";

const base = loadBase("ca5acac");
const src = base.src;
const file = "C:/Users/sasha/AppData/Local/Temp/basalt-app-base-ca5acac.js";
const bundle = loadBundle(file);

// top-level declared names -> kind
const top = new Map();
for (const n of bundle.body) {
  if (n.type === "FunctionDeclaration") top.set(n.id.name, "function");
  else if (n.type === "ClassDeclaration") top.set(n.id.name, "class");
  else if (n.type === "VariableDeclaration") {
    const names = new Set();
    const walk = (p) => { if (!p) return; if (p.type === "Identifier") names.add(p.name); for (const k in p) { if (k === "type") continue; const v = p[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); } };
    for (const d of n.declarations) walk(d.id);
    for (const x of names) top.set(x, "var");
  }
}

const PURE = new Set(["undefined", "NaN", "Infinity", "globalThis", "window", "document", "navigator", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask", "Promise", "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "RegExp", "Error", "TypeError", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt", "Intl", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "atob", "btoa", "crypto", "fetch", "FormData", "Blob", "File", "FileReader", "ArrayBuffer", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "DataView", "Proxy", "Reflect", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape", "structuredClone", "AbortController", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "CompositionEvent", "WheelEvent", "DragEvent", "ClipboardEvent", "TouchEvent", "MutationObserver", "ResizeObserver", "IntersectionObserver", "getComputedStyle", "requestIdleCallback", "cancelIdleCallback", "Image", "Audio", "Worker", "location", "history", "screen", "alert", "confirm", "prompt", "open", "close", "print", "postMessage", "BroadcastChannel", "MessageChannel", "MessagePort", "WebSocket", "XMLHttpRequest", "DOMParser", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLAnchorElement", "HTMLImageElement", "HTMLCanvasElement", "HTMLVideoElement", "HTMLAudioElement", "HTMLIFrameElement", "SVGElement", "DocumentFragment", "Text", "Comment", "Range", "Selection", "getSelection", "CSS", "matchMedia", "innerWidth", "innerHeight", "outerWidth", "outerHeight", "devicePixelRatio", "localStorage", "sessionStorage", "indexedDB", "caches", "Notification", "OffscreenCanvas", "Path2D", "CanvasRenderingContext2D"]);

function freeNames(node) {
  const bound = new Set();
  const free = new Set();
  const walk = (n, scope) => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier":
        if (!scope.has(n.name) && n.name !== "arguments" && n.name !== "this" && n.name !== "super" && n.name !== "new.target") free.add(n.name);
        return;
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": {
        const inner = new Set(scope);
        for (const p of n.params) pattern(p, inner);
        if (n.type === "FunctionDeclaration" && n.id) inner.add(n.id.name);
        if (n.type === "FunctionExpression" && n.id) inner.add(n.id.name);
        for (const st of n.body.type === "BlockStatement" ? n.body.body : [n.body]) walk(st, inner);
        return;
      }
      case "ClassDeclaration": case "ClassExpression": {
        const inner = new Set(scope);
        if (n.id) inner.add(n.id.name);
        for (const el of n.body.body) { if (el.type === "MethodDefinition" || el.type === "PropertyDefinition") { if (el.key && el.key.type === "Identifier" && !el.computed) { /* method names don't bind */ } walk(el.value, inner); walk(el.key, inner); } else if (el.type === "StaticBlock") walk(el, inner); }
        if (n.superClass) walk(n.superClass, scope);
        return;
      }
      case "VariableDeclaration": {
        for (const d of n.declarations) { walk(d.init, scope); pattern(d.id, scope); }
        return;
      }
      case "CatchClause": {
        const inner = new Set(scope); pattern(n.param, inner);
        walk(n.body, inner); return;
      }
      case "MemberExpression": walk(n.object, scope); if (n.computed) walk(n.property, scope); return;
      case "Property": case "PropertyDefinition": case "MethodDefinition":
        if (n.computed) walk(n.key, scope); if (n.value) walk(n.value, scope); return;
      case "LabeledStatement": walk(n.body, scope); return;
      case "BreakStatement": case "ContinueStatement": case "DebuggerStatement": case "EmptyStatement": case "ThisExpression": case "Super": case "MetaProperty": case "Literal": case "PrivateIdentifier": return;
      default:
        for (const k in n) { if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => walk(x, scope)); else if (v && typeof v.type === "string") walk(v, scope); }
    }
  };
  const pattern = (p, scope) => {
    if (!p) return;
    if (p.type === "Identifier") { scope.add(p.name); return; }
    if (p.type === "RestElement") return pattern(p.argument, scope);
    if (p.type === "AssignmentPattern") return pattern(p.left, scope);
    if (p.type === "ArrayPattern") return p.elements.forEach((e) => pattern(e, scope));
    if (p.type === "ObjectPattern") return p.properties.forEach((e) => pattern(e.type === "RestElement" ? e.argument : e.value, scope));
  };
  walk(node, bound);
  return free;
}

for (const name of process.argv.slice(2)) {
  let node = null;
  for (const n of bundle.body) {
    if (n.type === "FunctionDeclaration" && n.id.name === name) node = n;
    if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.id.name === name) node = d.init;
  }
  if (!node) { console.log(name, "NOT FOUND"); continue; }
  const free = [...freeNames(node)].sort();
  const groups = { topVar: [], topFn: [], topClass: [], global: [], unknown: [] };
  for (const f of free) {
    if (top.has(f)) groups[top.get(f) === "function" ? "topFn" : top.get(f) === "class" ? "topClass" : "topVar"].push(f);
    else if (PURE.has(f)) groups.global.push(f);
    else groups.unknown.push(f);
  }
  console.log("=====", name, "size", node.end - node.start);
  for (const [k, v] of Object.entries(groups)) if (v.length) console.log(" ", k, v.join(", "));
}
