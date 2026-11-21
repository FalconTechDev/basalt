// g23 shared helpers: i18n lookup, small DOM/string/storage utilities.
// Clean-room: only generic helpers live here; every module keeps its own i18n paths.

/** Resolve a dotted i18n path on host.t; calls function leaves (with `arg` when given). */
export function ng23T(host, path, fallback, arg) {
  try {
    let node = host.t;
    for (const part of path.split(".")) {
      node = node == null ? undefined : node[part];
      if (node === undefined || node === null) return fallback;
    }
    const value = typeof node === "function" ? (arg !== undefined ? node(arg) : node()) : node;
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

/** moment.js global, when present. */
export function ng23Moment() {
  return (typeof window !== "undefined" && window.moment) || globalThis.moment || null;
}

/** Case-insensitive contains. */
export function ng23Contains(text, query) {
  return String(text == null ? "" : text).toLowerCase().includes(String(query == null ? "" : query).toLowerCase());
}

/** Splits "Name: rest" into [prefix-with-colon, rest]. */
export function ng23SplitPrefix(name) {
  const s = String(name == null ? "" : name);
  const at = s.indexOf(": ");
  return at < 0 ? ["", s] : [s.slice(0, at + 2), s.slice(at + 2)];
}

/** formatHotkey guarded. */
export function ng23FormatHotkey(host, hotkey) {
  try { return hotkey ? host.formatHotkey(hotkey) : ""; } catch (err) { return ""; }
}

/** {modifiers,key} record from a keymap `info` ({modifiers compiled, key, vkey}). */
export function ng23HotkeyFromInfo(host, info) {
  return { modifiers: host.Keymap.decompileModifiers(info.modifiers || ""), key: info.vkey || info.key };
}

/** Effective hotkeys of a command id: custom list wins over defaults (custom may be []). */
export function ng23EffectiveHotkeys(app, id) {
  const mgr = app.hotkeyManager;
  if (!mgr) return [];
  const custom = mgr.getHotkeys(id);
  return custom !== undefined ? custom : (mgr.getDefaultHotkeys(id) || []);
}

/** app.loadLocalStorage / saveLocalStorage guarded. */
export function ng23LoadStorage(app, key) {
  try { return app.loadLocalStorage(key); } catch (err) { return null; }
}
export function ng23SaveStorage(app, key, value) {
  try { app.saveLocalStorage(key, value); } catch (err) {}
}

export function ng23GetConfig(app, key) {
  try { return app.vault.getConfig(key); } catch (err) { return undefined; }
}
export function ng23SetConfig(app, key, value) {
  try { app.vault.setConfig(key, value); } catch (err) {}
}

export function ng23Later(fn, ms) { setTimeout(fn, ms); }

export const ng23Collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
export function ng23Compare(a, b) { return ng23Collator.compare(String(a), String(b)); }

/** Pinned ids first (pin order), then the rest by collator on name. */
export function ng23OrderByPinned(items, pinned, idOf, nameOf) {
  const pinIndex = new Map();
  (pinned || []).forEach((id, i) => { if (!pinIndex.has(id)) pinIndex.set(id, i); });
  const rank = (item) => {
    const i = pinIndex.get(idOf(item));
    return i === undefined ? Number.MAX_SAFE_INTEGER : i;
  };
  return items.slice().sort((a, b) => {
    const ra = rank(a); const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return ng23Compare(nameOf(a), nameOf(b));
  });
}

/** Stable-float items whose id appears in `recents` (MRU first) to the top. */
export function ng23FloatRecents(items, recents, idOf) {
  const order = new Map();
  (recents || []).forEach((id, i) => { if (!order.has(id)) order.set(id, i); });
  return items.slice().sort((a, b) => {
    const ra = order.get(idOf(a)); const rb = order.get(idOf(b));
    const ea = ra === undefined ? Number.MAX_SAFE_INTEGER : ra;
    const eb = rb === undefined ? Number.MAX_SAFE_INTEGER : rb;
    return ea - eb;
  });
}

export function ng23ToggleClass(el, cls, on) { if (el) el.toggleClass(cls, !!on); }
export function ng23SetText(el, text) { if (el) el.setText(text); }

/** createEl/createDiv/createSpan safe wrappers (bundle globals may be absent in tests). */
export function ng23CreateEl(options, callback) {
  const doc = (typeof document !== "undefined" && document) || null;
  if (!doc) return null;
  const el = doc.createElement(options && options.tag ? options.tag : "div");
  if (options) {
    if (options.cls) el.className = options.cls;
    if (options.text != null) el.textContent = options.text;
    if (options.attr) for (const k in options.attr) el.setAttribute(k, options.attr[k]);
  }
  if (callback) callback(el);
  return el;
}

/** Walk bookmark items (groups have .items). */
export function ng23WalkBookmarks(items, visit) {
  for (const item of items || []) {
    visit(item);
    if (item && item.type === "group" && Array.isArray(item.items)) ng23WalkBookmarks(item.items, visit);
  }
}

export function ng23EscapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
