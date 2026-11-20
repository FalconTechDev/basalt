// g31 clean-room: ordering primitives + quickselect (spec g31 part A).
// Pure functions; no host access, no DOM.

export function ng31Compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function ng31Swap(list, i, j) {
  const t = list[i];
  list[i] = list[j];
  list[j] = t;
}

// Index of `item` (strict equality), or first index where match(item, list[i])
// is truthy. The probe is the FIRST predicate argument, the candidate second.
export function ng31IndexOf(list, item, match) {
  if (!match) return list.indexOf(item);
  for (let i = 0; i < list.length; i++) if (match(item, list[i])) return i;
  return -1;
}

// Rearranges list[lo..hi] in place so list[k] holds the k-th smallest element
// under `compare`; the rest stays unordered. Introselect: median-of-medians
// pivot estimate narrows large spans, then Hoare-style partitioning.
export function ng31SelectKth(list, k, lo, hi, compare) {
  const cmp = compare || ng31Compare;
  const nth = (left, right) => {
    while (right > left) {
      let pivotIndex;
      const span = right - left + 1;
      if (span > 600) {
        // deterministic median-of-medians style estimate for large spans
        const groups = Math.floor(span / 5);
        const est = left + Math.floor((k - left) / groups) * 5 + 2;
        pivotIndex = Math.min(Math.max(est, left), right);
      } else {
        pivotIndex = left + ((right - left) >> 1);
      }
      ng31Swap(list, pivotIndex, right);
      const pivot = list[right];
      let store = left;
      for (let j = left; j < right; j++) {
        if (cmp(list[j], pivot) <= 0) {
          ng31Swap(list, store, j);
          store++;
        }
      }
      ng31Swap(list, store, right);
      if (k < store) right = store - 1;
      else if (k > store) left = store + 1;
      else return;
    }
  };
  nth(lo, hi);
}

// Same selection with defaults; `||` semantics are contractual (hi=0 falls
// back to length-1).
export function ng31Quickselect(list, k, lo, hi, compare) {
  ng31SelectKth(list, k, lo || 0, hi || list.length - 1, compare || ng31Compare);
}

// Treats [lo,hi] as consecutive chunks of `size`; for each chunk larger than
// `size` selects the chunk's middle index via an explicit stack. `k` is part
// of the signature and unused.
export function ng31QuickselectChunks(list, k, lo, hi, size, compare) {
  const stack = [[lo, hi]];
  while (stack.length) {
    const range = stack.pop();
    const start = range[0];
    const end = range[1];
    if (end - start <= size) continue;
    const mid = start + Math.ceil((end - start) / size / 2) * size;
    if (mid <= start || mid >= end) continue;
    ng31SelectKth(list, mid, start, end, compare);
    stack.push([start, mid], [mid, end]);
  }
}

// ---- bounding boxes (RBush-style node bounds {minX,minY,maxX,maxY}) ----

export function ng31NewNode(children) {
  return {
    children,
    height: 1,
    leaf: true,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

export function ng31GrowBounds(bounds, other) {
  if (other.minX < bounds.minX) bounds.minX = other.minX;
  if (other.minY < bounds.minY) bounds.minY = other.minY;
  if (other.maxX > bounds.maxX) bounds.maxX = other.maxX;
  if (other.maxY > bounds.maxY) bounds.maxY = other.maxY;
  return bounds;
}

// Union of children [from,to). Leaf parents measure each child through
// `measure`; inner children contribute their own bounds. `out` is reset to
// the infinite-empty box before accumulation.
export function ng31ChildrenBounds(node, from, to, measure, out) {
  const result = out || ng31NewNode(null);
  result.minX = Infinity;
  result.minY = Infinity;
  result.maxX = -Infinity;
  result.maxY = -Infinity;
  for (let i = from; i < to; i++) {
    const child = node.children[i];
    ng31GrowBounds(result, node.leaf ? measure(child) : child);
  }
  return result;
}

export function ng31SubtreeBounds(node, measure) {
  return ng31ChildrenBounds(node, 0, node.children.length, measure, node);
}

export function ng31BoundsMinX(b) { return b.minX; }
export function ng31BoundsMinY(b) { return b.minY; }
export function ng31BoundsSpan(b) { return (b.maxX - b.minX) + (b.maxY - b.minY); }
export function ng31BoundsArea(b) { return (b.maxX - b.minX) * (b.maxY - b.minY); }

// Edge contact counts as contained / overlapping.
export function ng31BoundsContains(outer, inner) {
  return inner.minX >= outer.minX && inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

export function ng31BoundsOverlap(a, b) {
  return b.minX <= a.maxX && b.minY <= a.maxY && b.maxX >= a.minX && b.maxY >= a.minY;
}


// ---- rectangular selection ranges (bases table/cards) ----
// cell {row,column,groupIdx} -> range {top,bottom,start,end,groupIdx};
// top/bottom and start/end are inclusive. Key order is contractual.

export function ng31CellRange(cell) {
  if (!cell) return null;
  return {
    start: cell.column,
    top: cell.row,
    end: cell.column,
    bottom: cell.row,
    groupIdx: cell.groupIdx,
  };
}

// New range = union of `range` (or the cell alone), `cell` and `target`,
// then edge pull-out: when an edge of the ORIGINAL range sits exactly on the
// cell's row/column and the target lies strictly inside toward the range,
// that edge jumps to the target (whole rows/columns instead of a notch).
export function ng31ExtendRange(range, cell, target) {
  const base = range || ng31CellRange(cell);
  const top = Math.min(base.top, cell.row, target.row);
  const bottom = Math.max(base.bottom, cell.row, target.row);
  const start = Math.min(base.start, cell.column, target.column);
  const end = Math.max(base.end, cell.column, target.column);
  let newTop = top, newBottom = bottom, newStart = start, newEnd = end;
  if (base.top === cell.row && target.row > base.top && target.row <= base.bottom) newTop = target.row;
  if (base.bottom === cell.row && target.row < base.bottom && target.row >= base.top) newBottom = target.row;
  if (base.start === cell.column && target.column > base.start && target.column <= base.end) newStart = target.column;
  if (base.end === cell.column && target.column < base.end && target.column >= base.start) newEnd = target.column;
  return { top: newTop, bottom: newBottom, start: newStart, end: newEnd, groupIdx: base.groupIdx };
}

