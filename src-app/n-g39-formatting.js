// g39 clean-room: live-preview formatting helpers (spec g39 part E), file 1.
// All syntax-tree access goes through the host parameter (last arg).

const NG39_SKIP_CLASSES = ["HyperMD-table-2", "HyperMD-codeblock"];
const NG39_MARKER_CLASSES = ["hmd-list-indent", "formatting-quote", "formatting-list", "formatting-task", "formatting-header"];

function ng39ClassTokens(cls) {
  return cls ? String(cls).split(/\s+/).filter(Boolean) : [];
}

function ng39HasClass(cls, name) {
  return ng39ClassTokens(cls).indexOf(name) >= 0;
}

function ng39NodeClasses(node, host, prop) {
  const p = prop || host.cmSyntaxPropClasses;
  return node && node.type && typeof node.type.prop === "function" ? node.type.prop(p) : null;
}

export function ng39FormatSkips(state, range, host) {
  let found = false;
  try {
    host.cmSyntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (found) return false;
        const cls = ng39NodeClasses(node, host, host.livePreviewSyntaxClasses);
        if (cls) {
          for (const c of NG39_SKIP_CLASSES) {
            if (ng39HasClass(cls, c)) { found = true; return false; }
          }
        }
        return undefined;
      },
    });
  } catch (e) { /* partial tree: report what was seen */ }
  return found;
}
