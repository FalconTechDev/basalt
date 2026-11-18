// g24 clean-room: the public `Editor` base class (plugin-API surface).
// Pure document logic over the low-level primitives the concrete editor
// (n-g09 EditorImpl) provides: getLine/lineCount/replaceRange/transaction/
// exec/listSelections/getSelection/getCursor/setSelection/getRange/posAtCoords.
// Positions are {line (0-based), ch}; every multi-line edit is ONE transaction.

// ---------------------------------------------------------------------------
// line/selection collection shared by the block operations
// ---------------------------------------------------------------------------

/** Union of line numbers covered by every selection, deduped, ascending. */
function ng24SelectedLines(editor) {
  const lines = new Set();
  for (const sel of editor.listSelections()) {
    const a = sel.anchor, h = sel.head;
    const lo = Math.min(a.line, h.line), hi = Math.max(a.line, h.line);
    for (let i = lo; i <= hi; i++) lines.add(i);
  }
  return Array.from(lines).sort((x, y) => x - y);
}

/**
 * Maps each selected line through `lineFn(lineNo, text) -> value` then
 * `changeFn(lineNo, text, value) -> {from, to?, text} | null` and applies all
 * resulting changes in a single transaction.
 *
 * `skipBlank` (default true) drops blank lines — but only when more than one
 * line is selected; the dropped slots still occupy their index so line numbers
 * stay aligned.
 *
 * A single collapsed cursor sitting at ch 0 of the first changed line gets an
 * explicit `selection` shifted by that line's text-length delta.
 */
function ng24ProcessLines(editor, lineFn, changeFn, skipBlank = true) {
  const lines = ng24SelectedLines(editor);
  if (!lines.length) return;
  const multi = lines.length > 1;
  const changes = [];
  const deltas = new Map(); // line -> length delta of its own change
  for (const lineNo of lines) {
    const text = editor.getLine(lineNo);
    if (skipBlank && multi && text.trim() === "") {
      deltas.set(lineNo, 0);
      continue;
    }
    const change = changeFn(lineNo, text, lineFn(lineNo, text));
    if (!change) {
      deltas.set(lineNo, 0);
      continue;
    }
    changes.push(change);
    const oldLen = change.to !== undefined ? change.to.ch - change.from.ch : 0;
    deltas.set(lineNo, String(change.text).length - oldLen);
  }
  if (!changes.length) return;
  const spec = { changes };
  const sels = editor.listSelections();
  if (sels.length === 1) {
    const s = sels[0];
    if (s.anchor.line === s.head.line && s.anchor.ch === s.head.ch && s.anchor.ch === 0) {
      const first = changes[0].from.line;
      if (s.anchor.line === first && deltas.has(first)) {
        spec.selection = { from: { line: first, ch: deltas.get(first) } };
      }
    }
  }
  editor.transaction(spec, "input.type");
}

// ---------------------------------------------------------------------------
// regexes for the markdown structure toggles
// ---------------------------------------------------------------------------

const NG24_HEADING_RE = /^([>\s]*)(#{1,6} )?(.*)$/;
// quote prefix: up to 3 spaces, ">", then whitespace
const NG24_QUOTE_RE = /^ {0,3}>(\s*)/;
// list marker: quote/space prefix, then "* "/"+ "/"- " or "12."/"12)" + optional "[x] "
const NG24_LIST_RE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;
// marker-only variant used by Enter-continuation (no checkbox group)
const NG24_MARKER_RE = /^([>\s]*)((?:[*+-]|\d+[.)])(?:[ \t]+|$))/;

// ---------------------------------------------------------------------------
// Editor base class
// ---------------------------------------------------------------------------

/** Factory for the `Editor` base class (manifest class entry `cP`). */
export function defineEditor() {
  function Editor() {}
  const proto = Editor.prototype;

  proto.getDoc = function () { return this; };

  /** Replaces the whole content of `line` (0-based), preserving line count. */
  proto.setLine = function (line, text) {
    const lineText = this.getLine(line);
    this.replaceRange(text, { line, ch: 0 }, { line, ch: lineText.length });
  };

  proto.somethingSelected = function () {
    return this.getSelection() !== "";
  };

  /** `line` may be a number (ch defaults to 0) or a {line, ch} position. */
  proto.setCursor = function (line, ch) {
    if (typeof line === "object" && line !== null) {
      this.setSelection(line);
    } else {
      this.setSelection({ line, ch: ch === undefined ? 0 : ch });
    }
  };

  proto.posAtMouse = function (event) {
    return this.posAtCoords(event.clientX, event.clientY);
  };

  /** Appends `text` at the end of the last line and moves the cursor to the
   *  new end of document. */
  proto.insertText = function (text) {
    const last = this.lineCount() - 1;
    const end = { line: last, ch: this.getLine(last).length };
    const str = String(text);
    const addedLines = str.split("\n");
    const cursor = addedLines.length === 1
      ? { line: last, ch: end.ch + str.length }
      : { line: last + addedLines.length - 1, ch: addedLines[addedLines.length - 1].length };
    this.transaction({
      changes: [{ from: end, text: str }],
      selection: { from: cursor },
    }, "input.type");
  };

  // Exposed for subclasses / parity with the inherited surface.
  proto.processLines = function (lineFn, changeFn, skipBlank) {
    ng24ProcessLines(this, lineFn, changeFn, skipBlank === undefined ? true : skipBlank);
  };

  /**
   * Sets/removes the ATX heading level on every selected line.
   * Keeps the quote/space prefix and the heading text; level 0 strips the marker.
   */
  proto.setHeading = function (level) {
    const hashes = level > 0 ? "#".repeat(Math.min(6, level)) + " " : "";
    this.processLines(
      (lineNo, text) => text,
      (lineNo, text) => {
        const m = NG24_HEADING_RE.exec(text);
        if (!m) return null;
        const prefix = m[1] || "";
        const marker = m[2] || "";
        if (marker === hashes) return null;
        return {
          from: { line: lineNo, ch: prefix.length },
          to: { line: lineNo, ch: prefix.length + marker.length },
          text: hashes,
        };
      },
      false,
    );
  };

  /**
   * Blockquote toggle: when ANY selected line lacks a `>` prefix, unquoted
   * lines get "> " prepended and already-quoted lines are untouched; when ALL
   * lines are quoted the quote marker is removed from each. Blank lines
   * participate (skipBlank = false).
   */
  proto.toggleBlockquote = function () {
    const lines = ng24SelectedLines(this);
    const infos = lines.map((lineNo) => {
      const text = this.getLine(lineNo);
      const m = NG24_QUOTE_RE.exec(text);
      return { lineNo, text, quoted: !!m, width: m ? m[0].length : 0 };
    });
    const allQuoted = infos.length > 0 && infos.every((i) => i.quoted);
    const changes = [];
    for (const info of infos) {
      if (allQuoted) {
        const lead = /^ {0,3}/.exec(info.text)[0].length;
        changes.push({
          from: { line: info.lineNo, ch: lead },
          to: { line: info.lineNo, ch: info.width },
          text: "",
        });
      } else if (!info.quoted) {
        changes.push({ from: { line: info.lineNo, ch: 0 }, text: "> " });
      }
    }
    if (changes.length) this.transaction({ changes }, "input.type");
  };

  /** Bullet toggle: ordered items and task items count as "non-bullet". */
  proto.toggleBulletList = function () {
    const lines = ng24SelectedLines(this);
    let hasNonBullet = false;
    for (const lineNo of lines) {
      const m = NG24_LIST_RE.exec(this.getLine(lineNo));
      if (!m) continue;
      const isPlainBullet = !!m[3] && m[4] === undefined && m[6] === undefined;
      if (!isPlainBullet) hasNonBullet = true;
    }
    const strip = !hasNonBullet; // every selected line is already a plain bullet
    this.processLines(
      (lineNo, text) => text,
      (lineNo, text) => {
        const m = NG24_LIST_RE.exec(text);
        if (!m) return null;
        const prefix = m[1] || "";
        const hasMarker = !!(m[3] || m[4] !== undefined);
        const isPlainBullet = !!m[3] && m[4] === undefined && m[6] === undefined;
        const markerLen = (m[3] || (m[4] !== undefined ? m[4] + (m[5] || "") + " " : "")).length
          + (m[6] !== undefined ? 4 : 0);
        const replacement = isPlainBullet ? (strip ? "" : "- ") : "- ";
        if (!hasMarker && replacement === "") return null;
        const toCh = prefix.length + markerLen;
        if (text.slice(prefix.length, toCh) === replacement) return null;
        return { from: { line: lineNo, ch: prefix.length }, to: { line: lineNo, ch: toCh }, text: replacement };
      },
      false,
    );
  };

  /** Numbered-list toggle: bullets and task items count as "non-number". */
  proto.toggleNumberList = function () {
    const lines = ng24SelectedLines(this);
    let hasNonNumber = false;
    for (const lineNo of lines) {
      const m = NG24_LIST_RE.exec(this.getLine(lineNo));
      if (!m) continue;
      const isNumber = m[4] !== undefined && m[6] === undefined;
      if (!isNumber) hasNonNumber = true;
    }
    const strip = !hasNonNumber;
    this.processLines(
      (lineNo, text) => text,
      (lineNo, text) => {
        const m = NG24_LIST_RE.exec(text);
        if (!m) return null;
        const prefix = m[1] || "";
        const hasMarker = !!(m[3] || m[4] !== undefined);
        const isNumber = m[4] !== undefined && m[6] === undefined;
        const markerLen = (m[3] || (m[4] !== undefined ? m[4] + (m[5] || "") + " " : "")).length
          + (m[6] !== undefined ? 4 : 0);
        const replacement = isNumber ? (strip ? "" : "1. ") : "1. ";
        if (!hasMarker && replacement === "") return null;
        const toCh = prefix.length + markerLen;
        if (text.slice(prefix.length, toCh) === replacement) return null;
        return { from: { line: lineNo, ch: prefix.length }, to: { line: lineNo, ch: toCh }, text: replacement };
      },
      false,
    );
  };

  /**
   * Checklist toggle. A tri-state is aggregated across the selected lines:
   *   3 = no list markers at all,
   *   2 = at least one unchecked "[ ]" (mixed or all-unchecked),
   *   1 = checkbox lines exist but none is unchecked,
   *   0 = `check` truthy and a marker-only line was seen.
   * Effect per line: 1 -> "[ ] ", 2 -> "[x] ", 3 -> "[ ] " when `check` else the
   * plain marker, 0 -> the plain marker (checkbox removed).
   */
  proto.toggleCheckList = function (check) {
    const lines = ng24SelectedLines(this);
    // Aggregate: the "most unchecked" state wins so mixed selections check all.
    let state = 3;
    const raise = (v) => { if (v > state) state = v; };
    for (const lineNo of lines) {
      const text = this.getLine(lineNo);
      const m = NG24_LIST_RE.exec(text);
      if (!m) continue;
      const hasMarker = !!(m[3] || m[4] !== undefined);
      if (!hasMarker) continue;
      const c = m[6];
      if (c === " ") raise(2);
      else if (c !== undefined) raise(1);
      else raise(check ? 0 : 1);
    }
    const suffixFor = () => {
      if (state === 1) return "[ ] ";
      if (state === 2) return "[x] ";
      if (state === 3) return check ? "[ ] " : "";
      return ""; // state 0
    };
    const suffix = suffixFor();
    this.processLines(
      (lineNo, text) => text,
      (lineNo, text) => {
        const m = NG24_LIST_RE.exec(text);
        if (!m) return null;
        const prefix = m[1] || "";
        const hasMarker = !!(m[3] || m[4] !== undefined);
        if (!hasMarker) return null;
        const bullet = m[3] || "";
        const number = m[4] !== undefined ? m[4] : null;
        const delim = m[5] || "";
        const markerText = number !== null ? number + delim + " " : bullet;
        const oldCheck = m[6];
        const oldSuffix = oldCheck !== undefined ? "[" + oldCheck + "] " : "";
        const checkStart = prefix.length + markerText.length;
        const checkEnd = checkStart + oldSuffix.length;
        if (suffix === oldSuffix) return null;
        return { from: { line: lineNo, ch: checkStart }, to: { line: lineNo, ch: checkEnd }, text: suffix };
      },
      false,
    );
  };

  /**
   * Wraps the selection in a "> [!NOTE]" callout, or inserts a whole callout
   * skeleton at an empty line start. The cursor/selection lands on the "Title"
   * span (ch 4..8 of the line after the marker).
   */
  proto.insertCallout = function () {
    const sels = this.listSelections();
    const changes = [];
    const selections = [];
    for (const sel of sels) {
      const a = sel.anchor, h = sel.head;
      const from = { line: Math.min(a.line, h.line), ch: Math.min(a.ch, h.ch) };
      const to = { line: Math.max(a.line, h.line), ch: Math.max(a.ch, h.ch) };
      const empty = from.line === to.line && from.ch === to.ch && from.ch === 0;
      if (empty) {
        changes.push({ from, text: "\n> [!NOTE] Title\n> Contents\n" });
        selections.push({ from: { line: from.line + 1, ch: 4 }, to: { line: from.line + 1, ch: 8 } });
        continue;
      }
      let marker = "> [!NOTE]\n> ";
      let lineShift = 0;
      if (from.line > 0) {
        marker = "\n" + marker;
        lineShift = 1;
        changes.push({ from: { line: from.line, ch: 0 }, text: "\n" });
      }
      changes.push({ from, text: marker });
      for (let l = from.line + 1; l <= to.line; l++) {
        changes.push({ from: { line: l, ch: 0 }, text: "> " });
      }
      if (to.line + 1 < this.lineCount()) {
        changes.push({ from: { line: to.line + 1, ch: 0 }, text: "\n" });
      }
      selections.push({
        from: { line: from.line + 1 + lineShift, ch: 4 },
        to: { line: from.line + 1 + lineShift, ch: 8 },
      });
    }
    if (changes.length) {
      this.transaction({ changes, selection: selections.length === 1 ? selections[0] : undefined }, "input.type");
    }
  };

  proto.insertCodeblock = function () {
    this.insertBlock("```", "```");
  };

  proto.insertMathBlock = function () {
    this.insertBlock("$$", "$$");
  };

  proto.indentList = function () {
    this.exec("indentMore");
  };

  proto.unindentList = function () {
    this.exec("indentLess");
  };

  // ------------------------------------------------------------------
  // Enter-key list continuation
  // ------------------------------------------------------------------

  /** Marker info for one line: quote/space prefix + optional list marker. */
  function ng24MarkerInfo(text) {
    const m = NG24_MARKER_RE.exec(text);
    if (!m) return null;
    const prefix = m[1] || "";
    const marker = m[2] || "";
    return { prefix, marker, markerEnd: prefix.length + marker.length, hasMarker: marker !== "" };
  }

  /**
   * Enter inside a markdown list continues it. EVERY selection must be
   * continuable, otherwise the whole operation falls back to
   * exec("newlineAndIndent"). Non-empty / multi-line selections always bail.
   */
  proto.newlineAndIndentContinueMarkdownList = function () {
    const sels = this.listSelections();
    const bail = () => this.exec("newlineAndIndent");
    if (!sels.length) return bail();
    const changes = [];
    const newSelections = [];
    for (const sel of sels) {
      const a = sel.anchor, h = sel.head;
      if (a.line !== h.line || a.ch !== h.ch) return bail();
      const lineNo = a.line;
      const text = this.getLine(lineNo);
      const info = ng24MarkerInfo(text);
      if (!info || (!info.hasMarker && info.prefix === "")) return bail();
      const rest = text.slice(info.markerEnd);
      const inQuote = !info.hasMarker && info.prefix !== "" && a.ch <= info.prefix.length;
      if (!inQuote && a.ch < info.markerEnd) return bail();
      const before = text.slice(0, a.ch);
      const charBefore = before.charAt(before.length - 1);
      const insertAt = { line: lineNo, ch: a.ch };

      if (rest.trim() === "") {
        // empty item: unwind the structure instead of continuing
        const prefix = info.prefix;
        if (info.hasMarker) {
          if (prefix === "") {
            // plain "- " with nothing after: delete the marker, keep the line
            changes.push({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: info.markerEnd }, text: "" });
            newSelections.push({ from: { line: lineNo, ch: 0 } });
          } else {
            // marker inside a quote/indent prefix: drop just the marker
            changes.push({ from: { line: lineNo, ch: prefix.length }, to: { line: lineNo, ch: info.markerEnd }, text: "" });
            newSelections.push({ from: { line: lineNo, ch: prefix.length } });
          }
        } else {
          // quote-only prefix: collapse one quote level
          const collapsed = prefix.replace(/>\s?$/, "");
          changes.push({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: prefix.length }, text: collapsed });
          newSelections.push({ from: { line: lineNo, ch: collapsed.length } });
        }
        continue;
      }

      // non-empty rest: continue the list on the next line
      const prefix = info.prefix;
      let nextMarker = "";
      const om = /^(\d+)([.)])[ \t]*$/.exec(info.marker);
      if (om) {
        nextMarker = String(parseInt(om[1], 10) + 1) + om[2] + " ";
      } else if (/^[*+-][ \t]+$/.test(info.marker)) {
        nextMarker = info.marker;
      } else if (!info.hasMarker && prefix !== "") {
        // bare quote prefix: look upward for an enclosing ordered item
        for (let l = lineNo - 1; l >= 0; l--) {
          const up = ng24MarkerInfo(this.getLine(l));
          if (!up) continue;
          const um = /^(\d+)([.)])[ \t]*$/.exec(up.marker);
          if (um && up.prefix.length === prefix.length) {
            nextMarker = String(parseInt(um[1], 10) + 1) + um[2] + " ";
            break;
          }
          if (up.prefix.length < prefix.length) break;
        }
      }
      // a task checkbox right after the cursor is preserved as "[ ] "
      let taskPrefix = "";
      const afterCursor = text.slice(a.ch);
      const leadWs = /^[ \t]*/.exec(afterCursor)[0];
      if (/^\[[ xX]\]/.test(afterCursor.slice(leadWs.length))) taskPrefix = "[ ] ";
      const insert = (charBefore || "") + "\n" + prefix + nextMarker + taskPrefix;
      changes.push({
        from: { line: lineNo, ch: a.ch - (charBefore ? 1 : 0) },
        to: insertAt,
        text: insert,
      });
      newSelections.push({
        from: { line: lineNo + 1, ch: prefix.length + nextMarker.length + taskPrefix.length },
      });
    }
    this.transaction({
      changes,
      selection: newSelections.length === 1 ? newSelections[0] : undefined,
    }, "input.type");
  };

  /**
   * Like the list continuation but only preserves leading whitespace: the list
   * marker itself is replaced by spaces (tabs -> 4 columns).
   */
  proto.newlineAndIndentOnly = function () {
    const sels = this.listSelections();
    const bail = () => this.newlineOnly();
    if (!sels.length) return bail();
    const changes = [];
    const newSelections = [];
    for (const sel of sels) {
      const a = sel.anchor, h = sel.head;
      if (a.line !== h.line || a.ch !== h.ch) return bail();
      const lineNo = a.line;
      const text = this.getLine(lineNo);
      const info = ng24MarkerInfo(text);
      if (!info || (!info.hasMarker && info.prefix === "")) return bail();
      const inQuote = !info.hasMarker && info.prefix !== "" && a.ch <= info.prefix.length;
      if (!inQuote && a.ch < info.markerEnd) return bail();
      const before = text.slice(0, a.ch);
      const charBefore = before.charAt(before.length - 1);
      const ws = (info.hasMarker ? info.marker : "").replace(/\S/g, (c) => (c === "\t" ? "    " : " "));
      const insert = (charBefore || "") + "\n" + info.prefix + ws;
      changes.push({
        from: { line: lineNo, ch: a.ch - (charBefore ? 1 : 0) },
        to: { line: lineNo, ch: a.ch },
        text: insert,
      });
      newSelections.push({ from: { line: lineNo + 1, ch: info.prefix.length + ws.length } });
    }
    this.transaction({
      changes,
      selection: newSelections.length === 1 ? newSelections[0] : undefined,
    }, "input.type");
  };

  proto.newlineOnly = function () {
    this.transaction({ replaceSelection: "\n" }, "input.type");
  };

  /**
   * CJK bracket expansion for an empty cursor: text ending in 【【 expands to
   * "[[" (or "![[" after ！), 】】 to "]]". First matching expander wins.
   */
  proto.expandText = function () {
    const sels = this.listSelections();
    if (sels.length !== 1) return;
    const sel = sels[0];
    if (sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch) return;
    const pos = sel.head;
    const before = this.getLine(pos.line).slice(0, pos.ch);
    const expanders = [
      { re: /！?【【$/, make: (m) => (m[0].charAt(0) === "！" ? "![[" : "[[") },
      { re: /】】$/, make: () => "]]" },
      { re: /【【$/, make: () => "[[" },
    ];
    for (const ex of expanders) {
      const m = ex.re.exec(before);
      if (m) {
        this.replaceRange(ex.make(m), { line: pos.line, ch: pos.ch - m[0].length }, pos);
        return;
      }
    }
  };

  return Editor;
}

