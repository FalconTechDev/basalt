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

  function post(m) {
    self.postMessage(m);
  }

  self.onmessage = (e) => {
    try {
      const t = e.data;
      if (Object.prototype.hasOwnProperty.call(t, "metadataCache")) {
        const buf = t.metadataCache;
        if (!buf) return post({});
        const json = call("metadata", new Uint8Array(buf));
        return post(json === null ? null : JSON.parse(json));
      }
      if (Object.prototype.hasOwnProperty.call(t, "parseSections")) {
        opts = t.options || {};
        const json = call("sections", enc.encode(String(t.parseSections)));
        if (json === null) return post(null);
        const r = JSON.parse(json);
        return post({ sections: r.sections, frontmatter: r.frontmatter });
      }
    } catch (err) {
      console.error("AppWorker exception", err);
    }
    post(null);
  };
})();
