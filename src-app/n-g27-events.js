// g27 events: Events (named-event emitter, orig VT) and Component
// (load/unload lifecycle base, orig jm). Frozen plugin-facing surface:
// Events stores subscriptions in `this._` as {e,name,fn,ctx} records;
// Component owns `_loaded`, `_events` (LIFO cleanups) and `_children`.

import { methods } from "./n-g27-inherit.js";

export function defineEvents() {
  function Events() {
    this._ = {};
  }

  methods(Events, {
    on(name, callback, context) {
      const ref = { e: this, name, fn: callback, ctx: context };
      const list = this._[name] || (this._[name] = []);
      list.push(ref);
      return ref;
    },

    off(name, callback) {
      const list = this._[name];
      if (!list) return;
      if (!callback) {
        delete this._[name];
        return;
      }
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].fn === callback) list.splice(i, 1);
      }
      if (list.length === 0) delete this._[name];
    },

    offref(ref) {
      if (!ref) return;
      const list = this._[ref.name];
      if (!list) return;
      const i = list.indexOf(ref);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) delete this._[ref.name];
    },

    trigger(name) {
      const list = this._[name];
      if (!list || list.length === 0) return;
      const args = Array.prototype.slice.call(arguments, 1);
      const subs = list.slice();
      for (let i = 0; i < subs.length; i++) this.tryTrigger(subs[i], args);
    },

    tryTrigger(sub, args) {
      try {
        sub.fn.apply(sub.ctx, args);
      } catch (err) {
        // surface on a fresh macrotask: escapes promise machinery, cannot
        // break the remaining subscribers or the trigger caller
        setTimeout(() => { throw err; }, 0);
      }
    },
  });

  return Events;
}

export function defineComponent() {
  function Component() {
    this._loaded = false;
    this._events = [];
    this._children = [];
  }

  methods(Component, {
    onload() {},

    onunload() {},

    load() {
      if (this._loaded) return;
      this._loaded = true;
      const pending = [];
      const own = this.onload();
      if (own && typeof own.then === "function") pending.push(own);
      const children = this._children.slice();
      for (let i = 0; i < children.length; i++) {
        const result = children[i].load();
        if (result && typeof result.then === "function") pending.push(result);
      }
      if (pending.length > 0) return Promise.all(pending).then(() => {});
    },

    unload() {
      if (!this._loaded) return;
      this._loaded = false;
      while (this._children.length > 0) this._children.pop().unload();
      while (this._events.length > 0) this._events.pop()();
      this.onunload();
    },

    addChild(child) {
      this._children.push(child);
      if (this._loaded) child.load();
      return child;
    },

    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) {
        this._children.splice(i, 1);
        child.unload();
      }
      return child;
    },

    register(cleanup) {
      this._events.push(cleanup);
    },

    registerEvent(ref) {
      this.register(() => ref.e.offref(ref));
    },

    registerDomEvent(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      this.register(() => target.removeEventListener(type, listener, options));
    },

    registerScopeEvent(handler) {
      this.register(() => handler.scope.unregister(handler));
    },

    registerInterval(id) {
      this.register(() => clearInterval(id));
      return id;
    },
  });

  return Component;
}
