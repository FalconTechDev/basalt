// Events and Component: random sequences of subscribe / unsubscribe / trigger / load / unload / children, same log expected.
export const cases = [
  {
    orig: "VT", use: "defineEvents",
    origWorld: (O) => ({ Cls: O(["VT"]).VT }),
    ownWorld: (W) => ({ Cls: W([["VT", "defineEvents"]], {}).VT }),
    scenario({ Cls }, { log, rnd }) {
      const a = new Cls(), b = new Cls();
      const refs = [];
      const names = ["x", "y", "z"];
      const cbs = [];
      for (let i = 0; i < 6; i++) cbs.push(function (...args) { log.push(["cb", i, args, this && this.tag]); if (rnd.bool(0.2)) throw new Error("boom" + i); });
      const timers = [];
      const realST = globalThis.setTimeout;
      globalThis.setTimeout = (f) => { timers.push(f); return 0; };
      try {
        for (let step = 0; step < 40; step++) {
          const ev = rnd.bool() ? a : b, nm = rnd.pick(names);
          switch (rnd.i(6)) {
            case 0: { const r = ev.on(nm, rnd.pick(cbs), rnd.bool() ? { tag: "ctx" } : undefined); refs.push(r); log.push(["on", r.name, r.e === a ? "a" : "b", Object.keys(r).sort()]); break; }
            case 1: ev.off(nm, rnd.pick(cbs)); log.push(["off", Object.keys(ev._).sort(), Object.values(ev._).map((l) => l.length)]); break;
            case 2: if (refs.length) { ev.offref(rnd.pick(refs)); } else ev.offref(null); log.push(["offref", Object.keys(ev._).sort()]); break;
            case 3: ev.trigger(nm, step, "arg"); break;
            case 4: ev.off(nm); log.push(["off-all", Object.keys(ev._).sort()]); break;
            case 5: { const r = ev.on(nm, () => { ev.off(nm, cbs[0]); ev.on(nm, cbs[1]); log.push("reentrant"); }); ev.trigger(nm); ev.offref(r); break; }
          }
        }
        log.push(["errors", timers.length]);
        for (const t of timers) { try { t(); } catch (e) { log.push(["async", e.message]); } }
      } finally { globalThis.setTimeout = realST; }
    },
  },
  {
    orig: "jm", use: "defineComponent",
    origWorld: (O) => ({ Cls: O(["jm"]).jm, Ev: O(["VT"]).VT }),
    ownWorld: (W) => { const w = W([["VT", "defineEvents"], ["jm", "defineComponent"]], {}); return { Cls: w.jm, Ev: w.VT }; },
    scenario({ Cls, Ev }, { log, rnd }) {
      const mk = (id) => { const c = new Cls(); c.onload = () => { log.push(["onload", id]); return rnd.bool(0.3) ? Promise.resolve() : undefined; }; c.onunload = () => log.push(["onunload", id]); return c; };
      const root = mk("root"), kids = [mk("k1"), mk("k2"), mk("k3")];
      const ev = new Ev();
      const target = { addEventListener: (t, f, o) => log.push(["add", t, o]), removeEventListener: (t, f, o) => log.push(["remove", t, o]) };
      const cleanup = (id) => () => log.push(["cleanup", id]);
      const scope = { unregister: (h) => log.push(["unreg", h.k]) };
      for (let step = 0; step < 30; step++) {
        switch (rnd.i(10)) {
          case 0: log.push(["load", root.load() instanceof Promise]); break;
          case 1: root.unload(); log.push(["unloaded", root._loaded]); break;
          case 2: log.push(["addChild", root.addChild(rnd.pick(kids)).constructor === Cls]); break;
          case 3: root.removeChild(rnd.pick(kids)); break;
          case 4: root.register(cleanup(step)); break;
          case 5: root.registerEvent(ev.on("q", () => {})); log.push(["subs", Object.keys(ev._).length]); break;
          case 6: root.registerDomEvent(target, "click", () => {}, rnd.bool() ? true : undefined); break;
          case 7: root.registerScopeEvent({ scope, k: step }); break;
          case 8: log.push(["iv", root.registerInterval(rnd.i(100) + 1000000)]); break;
          case 9: kids[rnd.i(3)].load(); break;
        }
        log.push(["state", root._loaded, root._children.length, root._events.length]);
      }
      root.unload();
      log.push(["final", Object.keys(ev._).length]);
    },
  },
];
