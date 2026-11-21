// g29 clean-room: unified-diff patch object (diff-match-patch patch
// structure) and the singleton progress-bar overlay (spec Part H).
import { env } from "./env.js";

export function defineDiffBuilder() {
  return class DiffBuilder {
    constructor() {
      this.diffs = [];
      this.start1 = 0;
      this.start2 = 0;
      this.length1 = 0;
      this.length2 = 0;
    }

    static rangeText(start, length) {
      if (length === 0) return start + ",0";
      if (length === 1) return String(start + 1);
      return start + 1 + "," + length;
    }

    toString() {
      const XD = env().XD || {};
      const prefix = { [XD.DIFF_DELETE]: "-", [XD.DIFF_INSERT]: "+", [XD.DIFF_EQUAL]: " " };
      let out = "@@ -" + DiffBuilder.rangeText(this.start1, this.length1)
        + " +" + DiffBuilder.rangeText(this.start2, this.length2) + " @@\n";
      for (const diff of this.diffs) {
        out += (prefix[diff[0]] !== undefined ? prefix[diff[0]] : " ") + encodeURI(diff[1]) + "\n";
      }
      return out.replace(/%20/g, " ");
    }
  };
}

function ng29BuildProgressDom(doc) {
  const containerEl = createDiv("progress-bar-container");
  const bar = containerEl.createDiv("progress-bar");
  const messageEl = bar.createDiv("progress-bar-message u-center-text");
  const indicator = bar.createDiv("progress-bar-indicator");
  indicator.createDiv("progress-bar-line");
  const lineEl = indicator.createDiv("progress-bar-subline");
  const line1El = indicator.createDiv("progress-bar-subline mod-increase");
  const line2El = indicator.createDiv("progress-bar-subline mod-decrease");
  return { containerEl, messageEl, lineEl, line1El, line2El, contextEl: bar.createDiv("progress-bar-context") };
}

export function defineProgressBar() {
  class ProgressBar {
    constructor(doc = env().activeDocument) {
      this.doc = doc;
      const dom = ng29BuildProgressDom(doc);
      this.containerEl = dom.containerEl;
      this.messageEl = dom.messageEl;
      this.lineEl = dom.lineEl;
      this.line1El = dom.line1El;
      this.line2El = dom.line2El;
      this.contextEl = dom.contextEl;
      this.containerEl.addEventListener("click", (event) => event.preventDefault());
      this.setUnknownProgress();
    }

    static get instance() {
      if (!this._instance) this._instance = new this(env().activeDocument);
      return this._instance;
    }

    show() {
      this.doc.body.prepend(this.containerEl);
      this.doc.body.addClass("in-progress");
      this.containerEl.style.opacity = "";
      return this;
    }

    hide() {
      this.containerEl.detach();
      this.doc.body.removeClass("in-progress");
      return this;
    }

    setMessage(text) {
      this.messageEl.setText(text);
      return this;
    }

    setUnknownProgress() {
      this.lineEl.hide();
      this.line1El.show();
      this.line2El.show();
      return this;
    }

    setProgress(done, total) {
      this.lineEl.show();
      this.line1El.hide();
      this.line2El.hide();
      this.lineEl.style.width = ((done / total) * 100).toFixed(4) + "%";
      return this;
    }

    clearContext() {
      this.contextEl.empty();
      return this;
    }

    setContext(builder) {
      this.contextEl.empty();
      builder(this.contextEl);
      return this;
    }
  }
  return ProgressBar;
}
