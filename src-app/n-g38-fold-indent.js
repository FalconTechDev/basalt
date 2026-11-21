// g38 clean-room: live-preview fold widgets + indent guides (spec g38 Part 8).
// Fold caret widgets on folded/foldable viewport lines, the transaction filter
// that unfolds edited folds, and vertical indent guides inside list/quote blocks.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng15MarkItemCollapsed } from "./n-g15-tree.js";

const ng38FoldBags = new WeakMap(); // host -> memoized CM values
function ng38FoldBag(host) {
  let bag = ng38FoldBags.get(host);
  if (!bag) { bag = {}; ng38FoldBags.set(host, bag); }
  return bag;
}

/** Leftmost folded range overlapping [from, to], or null. */
export function ng38FoldedRangeAt(ranges, from, to) {
  let best = null;
  ranges.between(from, to, (f, t) => {
    if (!best || f < best.from) best = { from: f, to: t };
  });
  return best;
}

function ng38BuildFoldIndicator(host) {
  function FoldIndicator(folded) {
    if (host.EmbedWidgetBase) host.EmbedWidgetBase.call(this);
    this.folded = folded;
  }
  if (host.EmbedWidgetBase) inherit(FoldIndicator, host.EmbedWidgetBase);
  FoldIndicator.prototype.eq = function (other) {
    return !!other && other.folded === this.folded;
  };
  FoldIndicator.prototype.toDOM = function (view) {
    const el = host.createDiv("cm-fold-indicator");
    const doc = el.ownerDocument || document;
    const icon = doc.createElement("div");
    icon.className = "collapse-indicator collapse-icon";
    el.appendChild(icon);
    ng15MarkItemCollapsed(el, this.folded);
    host.setIcon(icon, "right-triangle");
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (event) => {
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      const folded = ng38FoldedRangeAt(host.cmFoldedRanges(view.state), line.from, line.to);
      if (folded) {
        view.dispatch({ effects: host.cmUnfoldEffect.of(folded) });
        event.preventDefault();
        return;
      }
      const foldable = host.cmFoldableRange(view.state, line.from, line.to);
      if (foldable) {
        view.dispatch({ effects: host.cmFoldEffect.of(foldable) });
        event.preventDefault();
      }
    });
    return el;
  };
  return FoldIndicator;
}

export function ng38FoldIndicator(host) {
  const bag = ng38FoldBag(host);
  if (!bag.indicator) bag.indicator = ng38BuildFoldIndicator(host);
  return bag.indicator;
}

export function ng38FoldedDeco(host) {
  const bag = ng38FoldBag(host);
  if (!bag.foldedDeco) {
    bag.foldedDeco = host.cmDecoration.widget({ widget: new (ng38FoldIndicator(host))(true) });
  }
  return bag.foldedDeco;
}

export function ng38FoldableDeco(host) {
  const bag = ng38FoldBag(host);
  if (!bag.foldableDeco) {
    bag.foldableDeco = host.cmDecoration.widget({ widget: new (ng38FoldIndicator(host))(false) });
  }
  return bag.foldableDeco;
}

function ng38BuildFoldViewPlugin(host) {
  function FoldViewPlugin(view) {
    this.view = view;
    this.decorations = host.cmDecoration.none;
    this.wasComposing = false;
    this.decorations = this.buildDeco(view);
  }
  FoldViewPlugin.prototype.buildDeco = function (view) {
    const state = view.state;
    const foldedRanges = host.cmFoldedRanges(state);
    const foldedDeco = ng38FoldedDeco(host);
    const foldableDeco = ng38FoldableDeco(host);
    const builder = new host.s20CmRangeSet();
    for (const block of view.viewportLineBlocks || []) {
      const folded = ng38FoldedRangeAt(foldedRanges, block.from, block.to);
      let deco = null;
      if (folded) deco = foldedDeco;
      else if (host.cmFoldableRange(state, block.from, block.to)) deco = foldableDeco;
      if (!deco) continue;
      const text = state.doc.sliceString(block.from, block.to);
      const indent = (text.match(/^[ \t]*/) || [""])[0].length;
      const at = block.from + indent;
      builder.add(at, at, deco);
    }
    return builder.finish();
  };
  FoldViewPlugin.prototype.update = function (tr) {
    if (tr.view && tr.view.composing) {
      this.decorations = this.decorations && typeof this.decorations.map === "function"
        ? this.decorations.map(tr.changes)
        : this.decorations;
      this.wasComposing = true;
      return;
    }
    const startState = tr.startState;
    const state = tr.state;
    const facetChanged = !!(startState && state && typeof state.facet === "function" && typeof startState.facet === "function")
      && state.facet(host.s40cmLanguageFacet) !== startState.facet(host.s40cmLanguageFacet);
    const foldedChanged = !!(startState && state)
      && host.cmFoldedRanges(startState) !== host.cmFoldedRanges(state);
    if (tr.docChanged || tr.viewportChanged || facetChanged || foldedChanged || this.wasComposing) {
      this.wasComposing = false;
      this.decorations = this.buildDeco(tr.view || this.view);
    }
  };
  return FoldViewPlugin;
}

export function ng38FoldViewPlugin(host) {
  const bag = ng38FoldBag(host);
  if (!bag.viewPlugin) bag.viewPlugin = ng38BuildFoldViewPlugin(host);
  return bag.viewPlugin;
}

export function ng38FoldTransactionFilter(host) {
  const bag = ng38FoldBag(host);
  if (!bag.txFilter) {
    bag.txFilter = host.cmState.transactionFilter.of((tr) => {
      if (!tr.docChanged || !host.notSetUserEvent(tr)) return tr;
      const folded = host.cmFoldedRanges(tr.startState);
      if (!folded || typeof folded.map !== "function") return tr;
      const mapped = folded.map(tr.changes);
      const effects = [];
      const seen = new Set();
      tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        mapped.between(fromA, fromB, (f, t) => {
          const key = f + ":" + t;
          if (!seen.has(key)) {
            seen.add(key);
            effects.push(host.cmUnfoldEffect.of({ from: f, to: t }));
          }
        });
      });
      if (!effects.length) return tr;
      return [tr, { effects, sequential: true }];
    });
  }
  return bag.txFilter;
}

export function ng38FoldDecorations(host) {
  const bag = ng38FoldBag(host);
  if (!bag.ext) {
    const plugin = host.cmViewPlugin.define(
      (view) => new (ng38FoldViewPlugin(host))(view),
      { decorations: (p) => p.decorations }
    );
    const atomic = host.cmView.atomicRanges.of((view) => host.cmFoldedRanges(view.state));
    bag.ext = [plugin, atomic, ng38FoldTransactionFilter(host)];
  }
  return bag.ext;
}

export function ng38IndentMarkPlain(host) {
  const bag = ng38FoldBag(host);
  if (!bag.markPlain) bag.markPlain = host.cmDecoration.mark({ class: "cm-indent" });
  return bag.markPlain;
}
export function ng38IndentMarkActive(host) {
  const bag = ng38FoldBag(host);
  if (!bag.markActive) bag.markActive = host.cmDecoration.mark({ class: "cm-indent cm-active-indent" });
  return bag.markActive;
}
export function ng38IndentMarkSpacing(host) {
  const bag = ng38FoldBag(host);
  if (!bag.markSpacing) bag.markSpacing = host.cmDecoration.mark({ class: "cm-indent-spacing" });
  return bag.markSpacing;
}

// Locate the enclosing list/quote context for the cursor line.
function ng38IndentContext(host, doc, state) {
  const pattern = host.listLinePattern;
  const cursorLine = doc.lineAt(state.selection.main.from);
  const m = cursorLine.text.match(pattern);
  if (m && m[0]) {
    return {
      cursorLine,
      prefix: m[1],
      unit: m[2] ? " ".repeat(m[2].length) : null,
    };
  }
  // Walk upward through markerless lines sharing one prefix; a deviating line
  // with a marker whose prefix extends the run becomes the context instead.
  let upPrefix = null;
  let contLine = null;
  let n = cursorLine.number - 1;
  while (n >= 1) {
    const ln = doc.line(n);
    const mm = ln.text.match(pattern);
    if (!mm || !mm[0] || mm[2]) break;
    if (upPrefix === null) upPrefix = mm[1];
    else if (mm[1] !== upPrefix) break;
    contLine = ln;
    n--;
  }
  const dev = n >= 1 ? doc.line(n) : null;
  const dm = dev ? dev.text.match(pattern) : null;
  if (dev && dm && dm[0] && dm[2] && upPrefix != null &&
      dm[1].startsWith(upPrefix) && dm[0].length <= upPrefix.length) {
    return { cursorLine: dev, prefix: dm[1], unit: " ".repeat(dm[2].length) };
  }
  if (contLine) return { cursorLine: contLine, prefix: upPrefix, unit: null };
  return { cursorLine, prefix: null, unit: null };
}

// Last line number still inside the indented block opened at cursorLine.
function ng38IndentBlockEnd(doc, cursorLine, prefix, unit) {
  if (prefix == null) return cursorLine.number;
  let end = cursorLine.number;
  let unitActive = !!unit;
  for (let n = cursorLine.number + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!text.startsWith(prefix)) break;
    let rest = text.slice(prefix.length);
    if (unitActive) {
      if (rest.startsWith(unit)) {
        end = n;
        continue;
      }
      unitActive = false;
    }
    if (!/^(\t| {4})/.test(rest)) break;
    end = n;
  }
  return end;
}

function ng38IndentDeco(host, view) {
  const state = view.state;
  const doc = state.doc;
  const { cursorLine, prefix, unit } = ng38IndentContext(host, doc, state);
  const blockEnd = ng38IndentBlockEnd(doc, cursorLine, prefix, unit);
  const plain = ng38IndentMarkPlain(host);
  const active = ng38IndentMarkActive(host);
  const spacing = ng38IndentMarkSpacing(host);
  const builder = new host.s20CmRangeSet();
  for (const block of view.viewportLineBlocks || []) {
    const line = doc.lineAt(block.from);
    const lm = line.text.match(/^[\s>]+/);
    if (!lm) continue;
    const lead = lm[0];
    let i = 0;
    while (i < lead.length) {
      const ch = lead[i];
      let len = 0;
      let kind = "step";
      if (ch === ">") {
        len = lead[i + 1] === " " ? 2 : 1;
      } else if (ch === "\t") {
        len = 1;
      } else if (ch === " ") {
        let run = 0;
        while (i + run < lead.length && lead[i + run] === " ") run++;
        if (run >= 4) len = 4;
        else { kind = "spacing"; len = 1; }
      } else {
        i++;
        continue;
      }
      const pos = line.from + i;
      if (kind === "spacing") {
        builder.add(pos, pos + 1, spacing);
      } else {
        const isActive = prefix != null && i === prefix.length &&
          cursorLine.number < line.number && line.number < blockEnd;
        builder.add(pos, pos + len, isActive ? active : plain);
      }
      i += len;
    }
  }
  return builder.finish();
}

function ng38BuildIndentGuides(host) {
  class IndentGuides {
    constructor(view) {
      this.view = view;
      this.decorations = ng38IndentDeco(host, view);
    }
    update(tr) {
      if (tr.docChanged || tr.viewportChanged || tr.selectionSet) {
        this.decorations = ng38IndentDeco(host, tr.view || this.view);
      }
    }
  }
  return host.cmViewPlugin.fromClass(IndentGuides, { decorations: (p) => p.decorations });
}

export function ng38IndentGuides(host) {
  const bag = ng38FoldBag(host);
  if (!bag.guides) bag.guides = ng38BuildIndentGuides(host);
  return bag.guides;
}

// Test-facing aliases for the legacy module contract.
export { ng38FoldedRangeAt as s40FoldedRangeAt, ng38FoldIndicator as s40FoldIndicator, ng38FoldedDeco as s40FoldedDeco, ng38FoldableDeco as s40FoldableDeco, ng38FoldViewPlugin as s40FoldViewPlugin, ng38FoldTransactionFilter as s40FoldTransactionFilter, ng38FoldDecorations as s40FoldDecorations, ng38IndentMarkPlain as s40IndentMarkPlain, ng38IndentMarkActive as s40IndentMarkActive, ng38IndentMarkSpacing as s40IndentMarkSpacing, ng38IndentGuides as s40IndentGuides };
