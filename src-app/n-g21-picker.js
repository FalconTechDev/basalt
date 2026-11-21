// n-g21-picker.js — FilePickerModal (n4) + Thumbnailer (s4).
// Clean-room, spec g21 §2.6/§3.6.

import { inherit } from "./inherit.js";
import { env } from "./env.js";

// =====================================================================================================================
// FilePickerModal — quick-switcher modal that inserts picked file content at the cursor
// =====================================================================================================================

export function ng21DefineS13FilePickerModal(host) {
  function FilePickerModal(parentArg, text) {
    const self = host.s13QuickSwitcherModalBase.call(this, parentArg) || this;
    self.text = text;
    self.emptyStateText = host.t.plugins.quickSwitcher.labelNoNoteCreateNew();
    self.allowCreateNewFile = true;
    self.shouldShowUnresolved = true;
    self.setPlaceholder("Choose file to insert");
    self.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to insert the text" },
      { command: "esc", purpose: "to cancel" },
    ]);
    return self;
  }
  inherit(FilePickerModal, host.s13QuickSwitcherModalBase);
  const proto = FilePickerModal.prototype;

  proto._createFile = async function (name) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Empty file name");
    return this.app.fileManager.createNewMarkdownFileFromLinktext(clean, "");
  };

  proto.onChooseSuggestion = async function (suggestion, event) {
    const app = this.app;
    try {
      let file = null;
      if (!suggestion) {
        file = await this._createFile(this.inputEl.value);
      } else if (suggestion.type === "unresolved") {
        file = await this._createFile(suggestion.linktext);
      } else if (suggestion.type === "file" || suggestion.type === "alias") {
        file = suggestion.file;
      }
      if (!file) return;
      await app.fileManager.insertIntoFile(file, this.text);
      await app.workspace.getLeaf().openFile(file);
    } catch (e) {
      console.error(e);
      try { new host.Notice(e && e.message ? e.message : String(e)); } catch (e2) {}
    }
  };

  return FilePickerModal;
}

// =====================================================================================================================
// Thumbnailer — downscaled data-URL backgrounds for remote images, cached per URL
// =====================================================================================================================

function ng21ChooseImage(elW, elH, imgW, imgH, dpr) {
  if (!(imgW > 0) || !(imgH > 0) || !(elW > 0) || !(elH > 0)) return { kind: "raw" };
  const scale = Math.max(elW / imgW, elH / imgH);
  const ratio = scale * (dpr || 1);
  if (ratio <= 0 || ratio > 0.5) return { kind: "raw" };
  return {
    kind: "canvas",
    width: Math.ceil(imgW * ratio),
    height: Math.ceil(imgH * ratio),
    ratio,
  };
}

export function ng21DefineS13Thumbnailer(host) {
  function Thumbnailer() {
    this.items = new Map();
    this.queue = new host.SerialTaskQueue();
    return this;
  }
  const p = Thumbnailer.prototype;

  p.thumbnailBg = function (el, url) {
    if (!el || !url) return;
    const cached = this.items.get(url);
    const apply = (value) => { el.style.backgroundImage = 'url("' + value + '")'; };
    if (cached) { apply(cached); return; }
    apply(url);
    let ext = "";
    try { ext = new URL(url, (typeof document !== "undefined" && document.baseURI) || undefined).pathname.split(".").pop().toLowerCase(); } catch (e) {}
    if (ext === "gif" || ext === "svg") return;
    const self = this;
    this.queue.queue(async () => {
      const expected = 'url("' + url + '")';
      const current = el.style.backgroundImage || "";
      if (current !== expected && current.indexOf(url) === -1) return;
      if (self.items.has(url)) { apply(self.items.get(url)); return; }
      const img = new Image();
      img.crossOrigin = "anonymous";
      const loaded = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 10000);
        img.onload = () => { clearTimeout(timer); resolve(true); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = url;
      });
      const now = el.style.backgroundImage || "";
      if (!loaded || (now !== expected && now.indexOf(url) === -1)) return;
      if (self.items.has(url)) { apply(self.items.get(url)); return; }
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const elW = rect ? rect.width : (el.offsetWidth || 0);
      const elH = rect ? rect.height : (el.offsetHeight || 0);
      if (!elW || !elH || (el.isShown === false)) return;
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const choice = ng21ChooseImage(elW, elH, img.naturalWidth || img.width, img.naturalHeight || img.height, dpr);
      if (choice.kind !== "canvas") { self.items.set(url, url); return; }
      const canvas = document.createElement("canvas");
      canvas.width = choice.width;
      canvas.height = choice.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { self.items.set(url, url); return; }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, choice.width, choice.height);
      const type = ext === "png" ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(type, 0.85);
      self.items.set(url, dataUrl);
      const latest = el.style.backgroundImage || "";
      if (latest === expected || latest.indexOf(url) !== -1) apply(dataUrl);
    }).catch(() => {});
  };

  p.clear = function () { this.items.clear(); };

  return Thumbnailer;
}
