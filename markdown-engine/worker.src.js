// Basalt's Markdown worker. Message handling only: the parser itself is Rust (markdown-engine/src), compiled to WebAssembly and
// inlined below by build-markdown.mjs, so this worker needs no network. Do not edit src/worker.js by hand, edit this file and rebuild.
//
// messages in:  { metadataCache: ArrayBuffer }          -> the file's links, tags, headings, sections ... (or {} for no input)
//               { parseSections: string, options }      -> { sections: [{ html, pos, level }], frontmatter }
// anything that goes wrong replies null.
(() => {
  "use strict";
  const WASM_B64 = "__WASM_B64__";
  let ex = null;
  // options of the last parseSections message; metadata is parsed with them too (the defaults until the first one arrives)
  let opts = { breaks: true, commonmark: true };
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function engine() {
    if (ex) return ex;
    const bin = atob(WASM_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ex = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
    return ex;
  }

  // run an exported parser on UTF-8 bytes, get its JSON text back (null when it failed)
  function call(name, bytes) {
    const w = engine();
    const ptr = w.alloc(bytes.length);
    new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
    const n = w[name](ptr, bytes.length, opts.breaks ? 1 : 0);
    w.dealloc(ptr, Math.max(bytes.length, 1));
    if (n < 0) return null;
    // the engine marks non-ASCII link targets; Unicode normalisation (NFC) is the one thing it leaves to the host
    return dec.decode(new Uint8Array(w.memory.buffer, w.out_ptr(), n)).replace(/([^]*)/g, (m, s) => s.normalize("NFC"));
  }

  // JSON cannot say NaN: the engine writes U+E003 for it
  function parse(json) {
    return json.includes("") ? JSON.parse(json, (k, v) => (v === "" ? NaN : v)) : JSON.parse(json);
  }

  // the bytes of an ArrayBuffer or a typed array; anything else is an error (the reply is null)
  function bytesOf(b) {
    const tag = Object.prototype.toString.call(b);
    if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return new Uint8Array(b);
    if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    throw new TypeError("metadataCache must be an ArrayBuffer");
  }

  // a string is the note; nothing (or an object, as a file description would be) is an empty note; other values are an error
  function textOf(v) {
    if (typeof v === "string") return v;
    if (v === null || v === undefined || typeof v === "object") return "";
    throw new TypeError("parseSections must be a string");
  }

  function post(m) {
    self.postMessage(m);
  }

  self.onmessage = (e) => {
    try {
      const t = e.data;
      if (Object.prototype.hasOwnProperty.call(t, "metadataCache")) {
        const buf = t.metadataCache;
        if (!buf) return post({});
        const json = call("metadata", bytesOf(buf));
        return post(json === null ? null : parse(json));
      }
      if (Object.prototype.hasOwnProperty.call(t, "parseSections")) {
        opts = t.options || {};
        const json = call("sections", enc.encode(textOf(t.parseSections)));
        if (json === null) return post(null);
        const r = parse(json);
        return post({ sections: r.sections, frontmatter: r.frontmatter });
      }
    } catch (err) {
      console.error("AppWorker exception", err);
    }
    post(null);
  };
})();
