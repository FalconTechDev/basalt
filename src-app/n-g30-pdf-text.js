// g30 clean-room: pdf.js text-layer selection helpers (spec g30 part F).
// Both helpers are pure DOM walks; no host/env dependencies.

const NG30_TEXT_LAYER = "textLayerNode";

function* ng30TextNodes(root) {
  const it = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let n = it.nextNode();
  while (n) {
    yield n;
    n = it.nextNode();
  }
}

/** Character offset of (node, offset) within root's text, or null outside root. */
export function ng30TextLayerOffset(root, node, offset) {
  if (!root.contains(node)) return null;
  let acc = 0;
  for (const tn of ng30TextNodes(root)) {
    if (tn === node) return acc + offset;
    acc += tn.textContent.length;
  }
  return acc + offset;
}

/** Nearest .textLayerNode ancestor-or-self inside root, or null. */
export function ng30TextLayerNode(root, node) {
  if (!root.contains(node)) return null;
  if (node instanceof HTMLElement && node.classList.contains(NG30_TEXT_LAYER)) return node;
  let cur = node.parentNode;
  while (cur && cur !== root) {
    if (cur instanceof HTMLElement && cur.classList.contains(NG30_TEXT_LAYER)) return cur;
    cur = cur.parentNode;
  }
  return null;
}
