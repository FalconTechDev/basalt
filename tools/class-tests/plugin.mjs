// Plugin base class against a fake app: every registration helper, the cleanups on unload, load ordering, data.json handling.
import { normalizePath } from "../../src-app/path.js";

function fakeApp(log, rnd) {
  const reg = (name) => (...a) => { log.push([name, ...a.map((x) => (typeof x === "function" ? "fn" : x && x.id ? x.id : x))]); };
  const app = {
    workspace: {
      leftRibbon: { addRibbonItemButton: (id, icon, title) => { log.push(["ribbon+", id, icon, title]); return { detach: () => log.push(["button.detach", id]) }; }, removeRibbonAction: reg("ribbon-") },
      trigger: reg("trigger"), registerHoverLinkSource: reg("hover+"), unregisterHoverLinkSource: reg("hover-"),
      registerEditorExtension: reg("ext+"), unregisterEditorExtension: reg("ext-"),
      registerObsidianProtocolHandler: reg("proto+"), unregisterObsidianProtocolHandler: reg("proto-"),
      detachLeavesOfType: reg("detach"), editorSuggest: { addSuggest: reg("sug+"), removeSuggest: reg("sug-") },
    },
    statusBar: { registerStatusBarItem: () => ({ addClass: (c) => log.push(["sb.class", c]), detach: () => log.push(["sb.detach"]) }) },
    commands: { addCommand: (c) => log.push(["cmd+", c.id, c.name]), removeCommand: reg("cmd-") },
    setting: { addSettingTab: (t) => log.push(["tab+", t.id]), removeSettingTab: (t) => log.push(["tab-", t.id]) },
    viewRegistry: { registerView: reg("view+"), unregisterView: reg("view-"), registerExtensions: reg("exts+"), unregisterExtensions: reg("exts-") },
    internalPlugins: { getEnabledPluginById: (id) => (id === "bases" && rnd.bool(0.7) ? { registerView: reg("bases+"), deregisterView: reg("bases-") } : null) },
    cli: { registerHandler: reg("cli+"), unregisterHandler: reg("cli-") },
    vault: {
      readPluginData: async (dir) => { log.push(["readData", dir]); return rnd.pick([null, { a: 1 }]); },
      writePluginData: async (dir, data, opts) => { log.push(["writeData", dir, data, typeof opts.mtime]); return "w"; },
      exists: async (p) => { log.push(["exists", p]); return rnd.bool(0.7); },
      readRaw: async (p) => "css:" + p,
      adapter: { stat: async (p) => { log.push(["stat", p]); if (rnd.bool(0.3)) throw new Error("nope"); return { mtime: rnd.i(100) }; } },
    },
    customCss: { styleEl: { tag: "styleEl" } },
  };
  return app;
}

export const cases = [{
  orig: "G0", use: "definePlugin",
  origWorld: (O) => {
    const renderer = {};
    return { mode: "orig", O };
  },
  ownWorld: (W) => ({ mode: "own", W }),
  scenario(world, { log, rnd }) {
    const realST = globalThis.setTimeout;
    globalThis.activeWindow = { setTimeout: () => 0, clearTimeout() {} };
    const created = [];
    globalThis.createEl = (tag, o) => { const el = { tag, o, detach: () => log.push(["style.detach"]) }; created.push(el); return el; };
    globalThis.document = { head: { insertBefore: (el, before) => log.push(["head.insert", el.textContent, before && before.tag]) } };
    const R = (name) => (...a) => { log.push([name, ...a.map((x) => (typeof x === "function" ? "fn" : x))]); return name === "createCodeBlockPostProcessor" ? "cbp:" + a[0] : undefined; };
    const renderer = { registerPostProcessor: R("pp+"), unregisterPostProcessor: R("pp-"), createCodeBlockPostProcessor: R("createCodeBlockPostProcessor"), registerCodeBlockPostProcessor: R("cbpp+"), unregisterCodeBlockPostProcessor: R("cbpp-") };
    const formulas = { addGlobal: (f) => log.push(["fg+", f.name]), removeGlobal: R("fg-"), addForType: (t, f) => log.push(["ft+", t, f.name]), removeForType: R("ft-") };
    let Plugin;
    if (world.mode === "orig") {
      const w = world.O(["VT", "jm", "G0"], { wc: (f) => f, Gz: renderer, QW: formulas, JD: "styles.css", cu: normalizePath });
      Plugin = w.G0;
    } else {
      const host = { MarkdownPreviewRenderer: renderer, FormulaFunctions: formulas, PLUGIN_STYLES_FILE: "styles.css" };
      Object.defineProperty(host, "Component", { get: () => host.jm });
      const w = world.W([["VT", "defineEvents"], ["jm", "defineComponent"], ["G0", "definePlugin"]], host);
      Plugin = w.G0;
    }
    const cleanup = () => { delete globalThis.activeWindow; delete globalThis.createEl; delete globalThis.document; };
    try {
      const app = fakeApp(log, rnd);
      const manifest = { id: rnd.pick(["My-Plugin", "x y!", "abc"]), name: "Name", dir: ".obs/plugins/p" };
      const p = new Plugin(app, manifest);
      const asyncResult = [];
      p.onload = function () { log.push(["onload"]); return new Promise((res) => { realST(() => { log.push(["onload-done"]); res(); }, 1); }); };
      const child = new (Object.getPrototypeOf(Plugin.prototype).constructor)();
      child.onload = () => log.push(["child.load"]);
      p.addChild(child);
      if (rnd.bool(0.5)) p.onExternalSettingsChange = () => log.push(["external"]);
      const steps = rnd.i(8) + 8;
      const result = p.load();
      log.push(["load-returns-promise", result instanceof Promise]);
      for (let i = 0; i < steps; i++) {
        switch (rnd.i(16)) {
          case 0: { const b = p.addRibbonIcon("star", "T" + i, () => {}); log.push(["ribbon-btn", typeof b.detach]); break; }
          case 1: p.addStatusBarItem(); break;
          case 2: { const c = { id: "c" + i, name: "n" + i }; log.push(["addCommand", p.addCommand(c) === c, c.id, c.name]); break; }
          case 3: p.removeCommand("c" + i); break;
          case 4: p.addSettingTab({ id: "tab" + i }); break;
          case 5: p.registerView("v" + i, () => {}); break;
          case 6: p.registerHoverLinkSource("h" + i, { display: "x" }); break;
          case 7: p.registerExtensions(["a" + i], "v"); break;
          case 8: log.push(["pp", p.registerMarkdownPostProcessor(() => {}, i) !== undefined]); break;
          case 9: log.push(["cbp", p.registerMarkdownCodeBlockProcessor("lang" + i, () => {}, i)]); break;
          case 10: log.push(["bases", p.registerBasesView("bv" + i, { r: i })]); break;
          case 11: p.registerGlobalFunc(function fn() {}); p.registerInstanceFunc("t" + i, function inst() {}); break;
          case 12: p.registerEditorExtension({ id: "e" + i }); p.registerObsidianProtocolHandler("act" + i, () => {}); p.registerEditorSuggest({ id: "s" + i }); break;
          case 13: p.registerCliHandler("cmd" + i, "desc", {}, () => {}); p.registerCodeMirror(() => {}); break;
          case 14: asyncResult.push(p.loadData(), p.saveData({ i }), p.loadCSS(), p.getModifiedTime()); break;
          case 15: asyncResult.push(p._onConfigFileChange(), p.onConfigFileChange && p.onConfigFileChange.constructor === Function ? 0 : 0); break;
        }
      }
      p._userDisabled = rnd.bool();
      return Promise.all(asyncResult).then((vals) => { log.push(["async", vals]); return result; }).then(() => { p.unload(); log.push(["unloaded", p._loaded]); }).finally(cleanup);
    } catch (e) { cleanup(); throw e; }
  },
}];
