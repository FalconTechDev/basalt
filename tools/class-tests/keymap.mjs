// Scope / DynamicScope / Keymap statics: key matching, modifier compilation, binding order, parent fall-through.
const KEYS = ["a", "A", "b", "Enter", "Escape", "ArrowUp", "F5", "/"];
const VKEYS = ["KeyA", "KeyB", "Enter", "Escape", "ArrowUp", "F5", "Slash"];
const MODS = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

function origKeyHelpers(os) {
  return { zl: os, Lg: (e) => e.key, Ig: (e) => e.vkey, tg: () => true, window: { addEventListener() {} } };
}

function worlds(os) {
  return {
    orig: (O) => { const w = O(["Ng", "Rg", "Bg"], origKeyHelpers(os)); return { Scope: w.Ng, Dyn: w.Rg, Keymap: w.Bg, os }; },
    own: (W) => {
      const host = { osName: os, eventKey: (e) => e.key, eventVirtualKey: (e) => e.vkey, focusElement: () => true };
      Object.defineProperty(host, "Scope", { get: () => host.Ng });
      Object.defineProperty(host, "Keymap", { get: () => host.Bg });
      const w = W([["Ng", "defineScope"], ["Rg", "defineDynamicScope"], ["Bg", "defineKeymap"]], host);
      return { Scope: w.Ng, Dyn: w.Rg, Keymap: w.Bg, os };
    },
  };
}

function scenario({ Scope, Dyn, Keymap }, { log, rnd }) {
  const pickMods = () => MODS.filter(() => rnd.bool(0.3));
  for (let i = 0; i < 6; i++) {
    const m = pickMods();
    const c = Keymap.compileModifiers(m);
    log.push(["compile", m, c, Keymap.decompileModifiers(c)]);
  }
  const mkScope = (name, parent) => {
    const s = new Scope(parent);
    const n = rnd.i(4);
    for (let i = 0; i < n; i++) {
      const mods = rnd.bool(0.3) ? null : pickMods();
      const key = rnd.bool(0.3) ? null : rnd.pick(KEYS.concat(VKEYS));
      const ret = rnd.pick([undefined, true, false]);
      const b = s.register(mods, key, (e, info) => { log.push(["fn", name, i, info.key, info.vkey]); return ret; });
      log.push(["reg", name, i, b.modifiers, b.key, b.scope === s]);
      if (rnd.bool(0.15)) { s.unregister(b); log.push(["unreg", name, s.keys.length]); }
    }
    return s;
  };
  const root = mkScope("root", null), mid = mkScope("mid", root), leaf = mkScope("leaf", mid);
  const other = mkScope("other", null);
  const dyn = new Dyn(leaf, () => (rnd.bool(0.4) ? other : null));
  for (let i = 0; i < 25; i++) {
    const k = rnd.i(KEYS.length);
    const info = { modifiers: Keymap.compileModifiers(pickMods()), key: rnd.bool(0.1) ? "" : KEYS[k], vkey: VKEYS[Math.min(k, VKEYS.length - 1)] };
    const target = rnd.pick([root, mid, leaf, dyn]);
    log.push(["handle", info, target.handleKey({ ev: i }, info)]);
    const ev = { ctrlKey: rnd.bool(), metaKey: rnd.bool(), altKey: rnd.bool(), shiftKey: rnd.bool(), button: rnd.i(3), instanceOf: () => true };
    log.push(["getMods", Keymap.getModifiers(ev), Keymap.isModifier(ev, rnd.pick(MODS.concat(["Nope"]))), Keymap.isModifierKey(rnd.pick(["Control", "Alt", "Shift", "OS", "Meta", "a"]))]);
  }
  const bindingProbe = { modifiers: rnd.bool(0.3) ? null : Keymap.compileModifiers(pickMods()), key: rnd.bool(0.3) ? null : rnd.pick(KEYS) };
  for (let i = 0; i < 10; i++) log.push(["isMatch", Keymap.isMatch(bindingProbe, { modifiers: Keymap.compileModifiers(pickMods()), key: rnd.pick(KEYS.concat([""])), vkey: rnd.pick(VKEYS) })]);
  const g = globalThis;
  const ME = function () {}; const PE = function () {};
  g.MouseEvent = ME; g.PointerEvent = PE;
  for (let i = 0; i < 10; i++) {
    const ev = { ctrlKey: rnd.bool(), metaKey: rnd.bool(), altKey: rnd.bool(), shiftKey: rnd.bool(), button: rnd.i(3), instanceOf: (C) => C === ME && rnd.bool(0.9) };
    log.push(["modEvent", Keymap.isModEvent(rnd.bool(0.1) ? null : ev)]);
  }
}

export const cases = ["Windows", "macOS"].map((os) => ({
  orig: "Bg", use: "defineKeymap",
  origWorld: worlds(os).orig,
  ownWorld: worlds(os).own,
  scenario,
}));
