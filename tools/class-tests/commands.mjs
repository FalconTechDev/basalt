// Commands registry + HotkeyManager against a fake app: command shapes (plain, check, editor, mobile-only), hotkeys, execution,
// default vs user hotkeys, baking and trigger matching, config load / save.
const KEYS = ["a", "b", "Enter", "p", "Escape"];
const HOTKEY_SETS = [[], ["Mod"], ["Mod", "Shift"], ["Alt"]];

function fakeEnv(log) {
  class MarkdownView { constructor(o) { Object.assign(this, o); } getMode() { return this.mode; } }
  const mk = (mode, extra = {}) => new MarkdownView({
    mode, editor: { tag: "ed" },
    inlineTitleEl: { isActiveElement: () => !!extra.inlineActive },
    titleEl: { isActiveElement: () => !!extra.titleActive },
  });
  const active = [null, mk("source"), mk("preview"), mk("source", { inlineActive: true }), mk("source", { titleActive: true }), { mode: "x", getMode: () => "source", editor: { tag: "plain" } }];
  const app = {
    scope: { register: (m, k, f) => { log.push(["scope.register", m, k, typeof f]); app.scopeFn = f; } },
    workspace: { get activeEditor() { return app.activeEditor; } },
    vault: {
      configDir: ".obs", on() {},
      readConfigJson: async (n) => { log.push(["read", n]); return app.cfg; },
      writeConfigJson: async (n, d) => { log.push(["write", n, JSON.parse(JSON.stringify(d))]); },
    },
    appMenuBarManager: { requestRender: () => log.push(["render"]) },
    activeEditor: null, cfg: null, lastEvent: undefined,
  };
  const K6 = (c) => { if (c.checkCallback) c.checkCallback(false); else if (c.callback) c.callback(); else throw new Error("no cb"); };
  const Rb = (h) => "H:" + (h.code || h.key) + ":" + h.modifiers.join("+");
  return { app, active, MarkdownView, K6, Rb };
}

function runScenario(world, log, rnd) {
  const env = fakeEnv(log);
  const Platform = { isMobile: world.isMobile, isDesktopApp: !world.isMobile };
  let Commands, Hotkeys, Keymap;
  if (world.mode === "orig") {
    Keymap = world.kb;
    const sym = Symbol("customKeys"); // the original aliases Db = Hb after the class definition
    const w = world.O(["Y6", "zb"], { Yl: Platform, W6: env.MarkdownView, K6: env.K6, Bg: Keymap, Nb: (c) => c, Rb: env.Rb, wc: (f) => f, Hb: sym, Db: sym });
    Commands = w.Y6; Hotkeys = w.zb;
  } else {
    const host = { Platform, MarkdownView: env.MarkdownView, runCommandCallback: env.K6, formatHotkey: env.Rb, osName: "Windows", eventKey: (e) => e.key, eventVirtualKey: (e) => e.vkey, focusElement: () => true };
    Object.defineProperty(host, "Scope", { get: () => host.Ng });
    Object.defineProperty(host, "Keymap", { get: () => host.Bg });
    const w = world.W([["Ng", "defineScope"], ["Rg", "defineDynamicScope"], ["Bg", "defineKeymap"], ["Y6", "defineCommands"], ["zb", "defineHotkeyManager"]], host);
    Commands = w.Y6; Hotkeys = w.zb; Keymap = w.Bg;
  }
  const app = env.app;
  app.hotkeyManager = new Hotkeys(app);
  app.commands = new Commands(app);
  const snapshot = () => ({
    cmds: Object.keys(app.commands.commands).sort(), ed: Object.keys(app.commands.editorCommands).sort(),
    defaults: Object.keys(app.hotkeyManager.defaultKeys).sort(), custom: Object.keys(app.hotkeyManager.customKeys).sort(),
    baked: app.hotkeyManager.baked,
  });
  const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const mkCmd = (id) => {
    const kind = rnd.i(7);
    const base = { id, name: id, hotkeys: rnd.bool(0.6) ? [{ modifiers: rnd.pick(HOTKEY_SETS), key: rnd.pick(KEYS) }] : undefined, repeatable: rnd.bool(0.3) };
    if (rnd.bool(0.2)) base.mobileOnly = true;
    if (rnd.bool(0.2)) base.showOnMobileToolbar = true;
    if (rnd.bool(0.15)) base.allowPreview = true;
    if (rnd.bool(0.15)) base.allowProperties = true;
    const run = (tag) => (...a) => { log.push(["ran", id, tag, a.length && a[a.length - 1] && a[a.length - 1].tag]); };
    switch (kind) {
      case 0: base.callback = run("cb"); break;
      case 1: base.checkCallback = (checking) => { log.push(["check", id, checking]); if (!checking) log.push(["ran", id, "check"]); return rnd.bool(0.7); }; break;
      case 2: base.editorCallback = run("edcb"); break;
      case 3: base.editorCheckCallback = (checking, ed) => { log.push(["edcheck", id, checking, ed && ed.tag]); return rnd.pick([true, false, undefined]); }; break;
      case 4: base.callback = () => { throw new Error("fail " + id); }; break;
      default: break; // no callback at all
    }
    return base;
  };
  for (let step = 0; step < 40; step++) {
    switch (rnd.i(12)) {
      case 0: case 1: { const id = rnd.pick(ids); const c = mkCmd(id); app.commands.addCommand(c); log.push(["add", id, !!c.checkCallback, snapshot()]); break; }
      case 2: { app.commands.removeCommand(rnd.pick(ids)); log.push(["remove", snapshot()]); break; }
      case 3: app.activeEditor = rnd.pick(env.active); log.push(["activeEditor", !!app.activeEditor]); break;
      case 4: log.push(["list", app.commands.listCommands().map((c) => c.id)]); break;
      case 5: log.push(["exec", app.commands.executeCommandById(rnd.pick(ids), { tag: "ev" }), app.lastEvent && app.lastEvent.tag]); break;
      case 6: { const id = rnd.pick(ids); app.hotkeyManager.setHotkeys(id, [{ modifiers: rnd.pick(HOTKEY_SETS), key: rnd.pick(KEYS) }]); log.push(["setHotkeys", id, snapshot()]); break; }
      case 7: { app.hotkeyManager.removeHotkeys(rnd.pick(ids)); log.push(["removeHotkeys", snapshot()]); break; }
      case 8: { const id = rnd.pick(ids); log.push(["print", app.hotkeyManager.printHotkeyForCommand(id), app.hotkeyManager.getHotkeys(id), app.hotkeyManager.getDefaultHotkeys(id)]); break; }
      case 9: {
        const info = { modifiers: Keymap.compileModifiers(rnd.pick(HOTKEY_SETS)), key: rnd.pick(KEYS), vkey: "Key" };
        const res = app.scopeFn({ repeat: rnd.bool(0.2) }, info);
        app.hotkeyManager.bake();
        log.push(["trigger", res, app.hotkeyManager.bakedIds.slice(), app.hotkeyManager.bakedHotkeys.map((h) => [h.modifiers, h.key])]);
        break;
      }
      case 10: app.cfg = rnd.pick([null, "str", {}, { c1: [{ modifiers: ["Mod"], key: "a" }], c3: [{ modifiers: [], code: "KeyX" }] }]); log.push(["load"]); app.pending = app.hotkeyManager.load(); break;
      case 11: app.pending = app.hotkeyManager.save(); log.push(["save"]); break;
    }
  }
  return app.pending;
}

export const cases = [false, true].map((isMobile) => ({
  orig: "Y6", use: "defineCommands",
  origWorld: (O) => ({
    mode: "orig", isMobile, O,
    kb: O(["Ng", "Rg", "Bg"], { zl: "Windows", Lg: (e) => e.key, Ig: (e) => e.vkey, tg: () => true, window: { addEventListener() {} } }).Bg,
  }),
  ownWorld: (W) => ({ mode: "own", isMobile, W }),
  scenario(world, { log, rnd }) {
    const realLog = console.log, realErr = console.error;
    console.log = (...a) => log.push(["console.log", String(a[0]), a[1]]);
    console.error = (e) => log.push(["console.error", String((e && e.message) || e)]);
    globalThis.activeWindow = { setTimeout: () => 0, clearTimeout() {} };
    globalThis.activeDocument = { activeElement: { closest: () => (rnd.bool(0.3) ? {} : null) } };
    try { runScenario(world, log, rnd); } finally { console.log = realLog; console.error = realErr; delete globalThis.activeDocument; delete globalThis.activeWindow; }
  },
}));
