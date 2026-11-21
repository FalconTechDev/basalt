// g39 clean-room: pure helpers, file 3 of 3 (spec g39 part A).

export function ng39NinesAtLeast(n) {
  let nines = 9;
  while (nines < n) nines = nines * 10 + 9;
  return nines;
}

export function ng39NewlinesBefore(text, end) {
  let n = 0;
  const s = String(text);
  const limit = Math.min(end, s.length);
  for (let i = 0; i < limit; i++) if (s.charAt(i) === "\n") n++;
  return n;
}

export function ng39LineBounds(text, line) {
  const s = String(text);
  let start = 0;
  let end = s.length;
  let l = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) === "\n") {
      if (l === line) { end = i; break; }
      l++;
      start = i + 1;
    }
  }
  return { start, end };
}

export function ng39KeyLabel(code) {
  const s = String(code);
  if (s.length === 4 && s.slice(0, 3) === "Key") return s.charAt(3);
  return s;
}

export function ng39MakeHotkey(modifiers, key) {
  return { modifiers, key };
}

export function ng39ValueIgnoringCase(obj, name) {
  const want = String(name).toLowerCase();
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && k.toLowerCase() === want) return obj[k];
  }
  return null;
}

export function ng39KeyIgnoringCase(obj, name) {
  if (Object.hasOwn(obj, name)) return name;
  const want = String(name).toLowerCase();
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && k.toLowerCase() === want) return k;
  }
  return name;
}
