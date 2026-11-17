// s10 application helpers: publish ajax predicates, preload-style promotion, filename
// validation, error tooltip, diff-match-patch merge + diff view, formula (de)serialization,
// folder/file helpers for the bases plugin, the change-by-line-range editor helper, vim
// mode helpers and the popout-window DOM event forwarders.
import { env } from "./env.js";
import { linesOf, longPropertyId } from "./text.js";
import { withoutExtension, extensionOf, lastSegment } from "./path.js";
import { ng08FlattenUniqueFiles } from "./n-g08-bookmarks.js";
import { isEditableNode } from "./tree.js";
import { s10ForwardedEvents, s10PopoutStyleVars, s10PopoutBodyClasses } from "./s10-consts.js";

// True when an XHR/fetch-style response carries the publish "obs-status" marker.
export function s10XhrHasObsStatus(e) {
  return !e || (e.getAllResponseHeaders().toLowerCase().contains("obs-status") && e.getResponseHeader("obs-status") !== null);
}

// Same check for fetch Response objects (headers map instead of xhr methods).
export function s10ResponseHasObsStatus(e) {
  return !e || (e.headers.has("obs-status") && e.headers.get("obs-status") !== null);
}

// Turns stylesheet <link rel="preload" as="style"> tags into real stylesheets and
// detaches the placeholder .preload nodes the starter page injected.
export function s10PromotePreloadStyles() {
  const head = Array.from(document.head.childNodes);
  for (let i = 0; i < head.length; i++) {
    const n = head[i];
    if (n instanceof HTMLLinkElement && n.rel === "preload" && n.as === "style") {
      n.onload = null;
      n.rel = "stylesheet";
    }
  }
  const placeholders = fishAll(".preload");
  if (placeholders) for (let i = 0; i < placeholders.length; i++) placeholders[i].detach();
}

// Validates a would-be file name; returns a localized error string or "".
export function s10ValidateFileName(e, t, n, i, host) {
  const { UT, qT } = env();
  const fileExplorer = host.t.plugins.fileExplorer;
  if (UT.test(n)) return fileExplorer.msgInvalidCharacters() + qT;
  if (i && n === "") return fileExplorer.msgEmptyFileName();
  if (n.startsWith(".")) return fileExplorer.msgBadDotfile();
  if (e.vault.checkForDuplicate(t, n)) return fileExplorer.msgFileAlreadyExists();
  return "";
}

// Shows the standard wide error tooltip used by file-name validation.
export function s10ShowErrorTooltip(e, t, host) {
  host.displayTooltip(e, t, { classes: ["mod-wide", "mod-error"] });
}

// Three-way merge of two texts through diff-match-patch; returns the merged text.
export function s10MergeText(e, t, n, host) {
  const dmp = new host.s10DiffMatchPatch();
  const diffs = dmp.diff_main(e, t, true, 0);
  if (diffs.length > 2) {
    dmp.diff_cleanupSemantic(diffs);
    dmp.diff_cleanupEfficiency(diffs);
  }
  const patches = dmp.patch_make(e, diffs);
  return dmp.patch_apply(patches, n)[0];
}

// Renders a line/word-level diff of two markdown-ish texts into a .diff-view element,
// folding long unchanged runs behind a "N lines folded" expander.
export function s10RenderDiffView(e, t, host) {
  if (!e.endsWith("\n")) e += "\n";
  if (!t.endsWith("\n")) t += "\n";
  const { createDiv, createFragment } = env();
  const { createEl } = host;
  const dmp = new host.s10DiffMatchPatch();
  const op = host.s10DiffOp;
  const diffs = dmp.diff_lineMode(e, t);
  dmp.diff_cleanupSemantic(diffs);
  const root = createDiv("diff-view");
  const line = (text, cls) => {
    const el = createEl("div", "diff-line");
    if (cls) el.addClass("mod-" + cls);
    if (text != null) el.setText(text);
    el.createEl("br");
    return el;
  };
  let unchanged = [];
  const flushUnchanged = (tail) => {
    if (unchanged.length === 0) return;
    const atStart = root.childNodes.length === 0;
    const keep = atStart || tail ? 5 : 10;
    if (unchanged.length > keep) {
      const hidden = [];
      const fold = createDiv("diff-collapsed");
      fold.addEventListener("click", () => {
        const parent = fold.parentNode;
        if (parent) {
          for (let i = 0; i < hidden.length; i++) parent.insertBefore(hidden[i], fold);
          fold.detach();
        }
      });
      let folded = 0;
      if (atStart) {
        for (let i = 0; i < unchanged.length - 3; i++) { hidden.push(unchanged[i]); folded++; }
        root.appendChild(fold);
        for (let i = unchanged.length - 3; i < unchanged.length; i++) root.appendChild(unchanged[i]);
      } else if (tail) {
        for (let i = 0; i < 3; i++) root.appendChild(unchanged[i]);
        root.appendChild(fold);
        for (let i = 3; i < unchanged.length; i++) { hidden.push(unchanged[i]); folded++; }
      } else {
        for (let i = 0; i < 3; i++) root.appendChild(unchanged[i]);
        for (let i = 3; i < unchanged.length - 3; i++) hidden.push(unchanged[i]), folded++;
        root.appendChild(fold);
        for (let i = unchanged.length - 3; i < unchanged.length; i++) root.appendChild(unchanged[i]);
      }
      fold.setText(`${folded} lines folded`);
    } else {
      for (let i = 0; i < unchanged.length; i++) root.appendChild(unchanged[i]);
    }
    unchanged = [];
  };
  let left = [];
  let right = [];
  const flushSides = () => {
    if (left.length === 0 && right.length === 0) return;
    for (let i = 0; i < left.length; i++) root.appendChild(left[i]);
    for (let i = 0; i < right.length; i++) root.appendChild(right[i]);
    left = [];
    right = [];
  };
  const emitPair = (a, b) => {
    const differ = a !== b;
    if (a && b && differ) {
      const wordDiffs = dmp.diff_wordMode(a, b);
      if (dmp.diff_levenshtein(wordDiffs) < Math.max(a.length, b.length) / 2) {
        const lf = createFragment();
        const rt = createFragment();
        for (let i = 0; i < wordDiffs.length; i++) {
          const d = wordDiffs[i];
          if (d[0] === op.DIFF_INSERT) rt.createSpan({ cls: "diff-changed", text: d[1] });
          else if (d[0] === op.DIFF_DELETE) lf.createSpan({ cls: "diff-changed", text: d[1] });
          else { lf.createSpan({ text: d[1] }); rt.createSpan({ text: d[1] }); }
        }
        flushUnchanged();
        left.push(line(lf, "left"));
        right.push(line(rt, "right"));
        return;
      }
    }
    if (differ) {
      flushUnchanged();
      left.push(line(a, "left"));
      right.push(line(b, "right"));
    } else {
      flushSides();
      unchanged.push(line(a, null));
    }
  };
  for (let p = 0; p < diffs.length; p++) {
    const kind = diffs[p][0];
    const oldLines = linesOf(diffs[p][1]);
    const next = p + 1;
    if (kind === op.DIFF_DELETE && next < diffs.length && diffs[next][0] === op.DIFF_INSERT) {
      const newLines = linesOf(diffs[next][1]);
      const count = Math.max(oldLines.length, newLines.length);
      for (let y = 0; y < count; y++) emitPair(oldLines[y], newLines[y]);
      p++;
    } else {
      for (let b = 0; b < oldLines.length; b++) {
        const k = oldLines[b];
        if (kind === op.DIFF_INSERT) emitPair(null, k);
        else if (kind === op.DIFF_DELETE) emitPair(k, null);
        else emitPair(k, k);
      }
    }
  }
  flushSides();
  flushUnchanged(true);
  return root;
}

// Serializes a parsed formula expression back to its identifier/linktext form.
export function s10FormulaIdentifier(e, host) {
  const { s10FmMember: WK, s10FmIndex: UK, s10FmIdent: QK, s10FmLiteral: GK, s10FmCall: jK, s10FmList: YK } = host;
  if (e instanceof WK) {
    if (e.object instanceof QK && ["note", "formula", "file"].contains(e.object.id)) {
      return "".concat(e.object.id, ".").concat(e.index);
    }
  } else if (e instanceof UK) {
    if (e.array instanceof QK) {
      const t = e.index;
      if (["file", "formula", "note"].contains(e.array.id) && t instanceof GK) {
        return "".concat(e.array.id, ".").concat(t.value.toString());
      }
    }
  } else if (e instanceof QK) {
    if (["true", "false", "null", "this"].contains(e.id)) throw new Error("Unsupported left-hand side of formula");
    return longPropertyId(e.id);
  }
  throw new Error("Formula cannot be deserialized");
}

// Serializes a formula link argument list to "[[target]]"/"[[target|alias]]" or a list.
export function s10FormulaLinktext(e, host) {
  const { s10FmLiteral: GK, s10FmCall: jK, s10FmList: YK } = host;
  if (e.length === 0) return "";
  if (e.length !== 1) {
    const s = [];
    for (let t = 0; t < e.length; t++) {
      const r = e[t];
      if (r instanceof GK) s.push(r.value.toString());
      else {
        if (!(r instanceof jK && r.name === "link" && r.args.length === 1)) throw new Error("Formula cannot be deserialized.");
        const i = r.args[0];
        if (i instanceof GK) s.push("[[".concat(i.value.toString(), "]]"));
      }
    }
    return s;
  }
  const r = e[0];
  if (r instanceof jK && r.name === "link") {
    const o = r.args[0], a = r.args[1];
    if (o instanceof GK) {
      return a && a instanceof GK ? "[[".concat(o.value, "|").concat(a.value, "]]") : "[[".concat(o.value, "]]");
    }
  } else {
    if (r instanceof YK) {
      const s = [];
      for (let l = 0; l < r.elements.length; l++) {
        const u = r.elements[l];
        if (!(u instanceof GK)) throw new Error("Formula cannot be deserialized");
        s.push(u.value.toString());
      }
      return s;
    }
    if (r instanceof GK) return r.value;
  }
  throw new Error("Formula cannot be deserialized");
}

// True when the node sits inside an editable metadata/title region.
export function s10IsEditableTarget(e, host) {
  if (isEditableNode(e)) return true;
  if (e.instanceOf(Element)) {
    if (e.closest(".metadata-container")) return true;
    if (e.closest(".inline-title")) return true;
  }
  return false;
}

// Whether every syntax node across [t,n) is inside a HyperMD table.
export function s10RangeInTable(e, t, n, host) {
  let found = false;
  e.iterate({
    from: t,
    to: n,
    enter(node) {
      const cls = node.type.prop(host.livePreviewSyntaxClasses);
      if (cls && cls.contains("HyperMD-table")) { found = true; return false; }
    },
  });
  return found;
}

// Folder containment test shared by the bases file lists.
function s10OutsideFolder(e, t, host) {
  return e !== t && !(e instanceof host.TFolder && e.isRoot()) && !(e instanceof host.TFolder && t.path.startsWith(e.path + "/"));
}

// True when file/folder `e` is not `t` itself nor inside `t`.
export function s10FolderContains(e, t, host) {
  return s10OutsideFolder(e, t, host);
}

// The subset of `e` outside folder `t`, deduplicated.
export function s10MovableFiles(e, t, host) {
  const out = [];
  for (let i = 0; i < e.length; i++) {
    const o = e[i];
    if (s10OutsideFolder(o, t, host)) out.push(o);
  }
  return ng08FlattenUniqueFiles(out);
}

// Moves each entry of `t` into folder `n` (or beside it), renaming through the vault and
// letting the file manager rewrite links afterwards.
export function s10MoveFilesAndUpdateLinks(e, t, n, host) {
  return (async () => {
    await e.fileManager.runAsyncLinkUpdate(async () => {
      const vault = e.vault;
      for (let r = 0; r < t.length; r++) {
        const a = t[r];
        if (a.parent === n) continue;
        let s = a.name;
        if (n.path !== "/") s = n.path + "/" + s;
        if (a instanceof host.TFile) {
          const l = withoutExtension(s);
          const c = extensionOf(lastSegment(s));
          s = vault.getAvailablePath(l, c);
        } else if (a instanceof host.TFolder) {
          s = vault.getAvailablePath(s);
        }
        await vault.rename(a, s);
      }
    });
  })();
}

// Applies `t(line, changes, range)` to every doc line intersecting each selection range.
export function s10ChangeByLineRange(e, t, host) {
  let last = -1;
  return e.changeByRange((range) => {
    const changes = [];
    for (let o = range.from; o <= range.to;) {
      const a = e.doc.lineAt(o);
      if (a.number > last && (range.empty || range.to > a.from)) {
        t(a, changes, range);
        last = a.number;
      }
      o = a.to + 1;
    }
    const s = e.changes(changes);
    return { changes, range: host.cmSelection.range(s.mapPos(range.anchor, 1), s.mapPos(range.head, 1)) };
  });
}

// Syncs vim insert mode when the configured mode changes.
export function s10VimModeSync(e, t, n, host) {
  if (t === n) return;
  if (t.contains("insert")) host.vimApi.enterInsertMode(e);
  else host.vimApi.exitInsertMode(e, true);
}

// Current vim mode name from the editor state, "" when vim is inactive.
export function s10VimModeName(e) {
  const t = e.state.vim;
  return t?.mode ?? "";
}

// Clones a DOM event so listeners can wrap preventDefault/stopPropagation while keeping
// the original target/currentTarget.
export function s10ForwardDomEvent(e) {
  const t = new e.constructor(e.type, e);
  const n = t.preventDefault;
  t.preventDefault = function () { n.call(t); e.preventDefault(); };
  const i = t.stopPropagation;
  t.stopPropagation = function () { i.call(t); e.stopPropagation(); };
  const r = t.stopImmediatePropagation;
  t.stopImmediatePropagation = function () { r.call(t); e.stopImmediatePropagation(); };
  Object.defineProperty(t, "target", { get: () => e.target });
  Object.defineProperty(t, "currentTarget", { get: () => e.currentTarget });
  return t;
}

// Re-dispatches the configured DOM events from a window onto the main window.
export function s10ForwardInputEvents(e) {
  for (let t = 0; t < s10ForwardedEvents.length; t++) {
    const i = s10ForwardedEvents[t];
    e.addEventListener(i, (ev) => window.dispatchEvent(s10ForwardDomEvent(ev)), { capture: true });
  }
}

// Mirrors document.head styles, body classes and CSS variables into a popout window `e`,
// keeping them in sync via a MutationObserver. `t` is a list of extra nodes to preserve.
export function s10MirrorStyles(e, t = [], host) {
  const { combineExtensions } = host;
  const cache = new WeakMap();
  let mirrored = [];
  const clone = (node) => {
    let c = cache.get(node);
    if (!c) {
      c = node.cloneNode(true);
      cache.set(node, c);
      if (node instanceof HTMLStyleElement && node.id === "MJX-CHTML-styles") {
        const rules = [];
        const cssRules = node.sheet.cssRules;
        for (let o = 0; o < cssRules.length; o++) rules.push(cssRules[o].cssText);
        c.textContent = rules.join("\n");
      }
    }
    return c;
  };
  const syncHead = () => {
    const keep = combineExtensions([], t, true);
    const head = Array.from(document.head.childNodes);
    for (let o = 0; o < head.length; o++) {
      const c = head[o];
      if ((c instanceof HTMLStyleElement || c instanceof HTMLLinkElement) && c.type === "text/css") {
        if (c instanceof HTMLStyleElement && c.textContent.contains("ͼ1")) continue;
        keep.push(clone(c));
      }
    }
    for (let s = 0; s < mirrored.length; s++) {
      const c = mirrored[s];
      if (!keep.contains(c)) c.detach();
    }
    const targetHead = e.document.head;
    let h = targetHead.lastChild;
    for (let p = keep.length - 1; p >= 0; p--) {
      const c = keep[p];
      if (h !== c) targetHead.insertBefore(c, h ? h.nextSibling : null);
      else h = h.previousSibling;
    }
    mirrored = keep;
  };
  const syncBody = () => {
    const srcBody = document.body;
    const dstBody = e.document.body;
    const srcClasses = srcBody.className.split(" ");
    const dstSet = new Set(dstBody.className.split(" "));
    for (let o = 0; o < s10PopoutBodyClasses.length; o++) {
      const s = s10PopoutBodyClasses[o];
      if (dstSet.has(s)) srcClasses.push(s);
      else srcClasses.remove(s);
    }
    const parent = e.parent;
    if (parent === e) srcClasses.push("is-popout-window");
    else if (parent) {
      if (parent.document.body.classList.contains("is-focused")) srcClasses.push("is-focused");
      else srcClasses.remove("is-focused");
    }
    dstBody.className = srcClasses.join(" ");
    for (let c = 0; c < srcBody.style.length; c++) {
      const u = srcBody.style[c];
      if (u.startsWith("--") && !s10PopoutStyleVars.contains(u)) {
        const h = srcBody.style.getPropertyValue(u);
        dstBody.style.setProperty(u, h);
      }
    }
    e.document.documentElement.style.setProperty("font-size", getComputedStyle(document.body).fontSize);
  };
  const observer = new MutationObserver((mutations) => {
    let headChanged = false;
    let bodyChanged = false;
    const drop = (node) => {
      if (node instanceof HTMLStyleElement || node instanceof HTMLLinkElement) {
        cache.delete(node);
        headChanged = true;
      }
    };
    for (let s = 0; s < mutations.length; s++) {
      const c = mutations[s];
      if (c.target !== document.body) {
        drop(c.target);
        const added = Array.from(c.addedNodes);
        for (let u = 0; u < added.length; u++) drop(added[u]);
      } else bodyChanged = true;
    }
    if (headChanged) syncHead();
    if (bodyChanged) syncBody();
  });
  observer.observe(document.head, { attributes: true, attributeFilter: ["data-change"], subtree: true, childList: true, characterData: true });
  observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  if (e.parent !== e) e.parent.addEventListener("focuschange", syncBody);
  syncHead();
  syncBody();
  return () => {
    observer.disconnect();
    if (e.parent) e.parent.removeEventListener("focuschange", syncBody);
  };
}
