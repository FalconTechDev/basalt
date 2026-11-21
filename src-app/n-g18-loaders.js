import { env } from "./env.js";
import { s04CreateDeferred } from "./n-g24-themes.js";

// g18 / s07-embeds.js — lazy third-party loaders and script workers.
// Every host/env access is lazy so this module can initialize early.

let ng18MathJaxDeferred = null;
let ng18MathJaxSheet = null;
let ng18MathJaxTimer = 0;

export function ng18MathJaxLoader() {
  if (!ng18MathJaxLoader.cached) {
    ng18MathJaxLoader.cached = env().Hv("/lib/mathjax/tex-chtml-full.js", {
      before: () => {
        window.MathJax = {
          tex: {
            inlineMath: [],
            displayMath: [],
            processEscapes: false,
            processEnvironments: false,
            processRefs: false,
          },
          startup: { typeset: false },
          options: {
            enableMenu: false,
            menuOptions: { settings: { renderer: "CHTML" } },
            renderActions: { assistiveMml: [] },
            safeOptions: {
              safeProtocols: { http: true, https: true, file: true, javascript: false, data: false },
            },
          },
        };
        if (window.publish) delete window.MathJax.options.renderActions;
        localStorage.removeItem("MathJax-Menu-Settings");
      },
    });
  }
  return ng18MathJaxLoader.cached;
}

export function ng18MermaidLoader() {
  if (!ng18MermaidLoader.cached) {
    ng18MermaidLoader.cached = env().Hv("/lib/mermaid.min.js", {
      after: () => {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          themeVariables: { fontFamily: "var(--font-mermaid)" },
          flowchart: { useMaxWidth: false },
          sequence: { useMaxWidth: false },
          gantt: {
            useMaxWidth: true,
            axisFormatter: [["%Y-%m-%d", (date) => date.getDay() === 1]],
          },
          journey: { useMaxWidth: true },
          class: { useMaxWidth: true },
          git: { useMaxWidth: false },
          state: { useMaxWidth: true },
          er: { useMaxWidth: false },
          pie: { useMaxWidth: true },
        });
      },
    });
  }
  return ng18MermaidLoader.cached;
}

export function ng18PdfJsLoader() {
  if (!ng18PdfJsLoader.cached) {
    ng18PdfJsLoader.cached = env().Hv("/lib/pdfjs/pdf.min.mjs", {
      type: "module",
      after: () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
        env().Jl(window, "pdfjsLib");
        env().Jl(window.pdfjsLib.GlobalWorkerOptions, "workerSrc");
      },
    });
  }
  return ng18PdfJsLoader.cached;
}

export function ng18PrismLoader() {
  if (!ng18PrismLoader.cached) {
    ng18PrismLoader.cached = env().Hv("/lib/prism.min.js", {
      before: () => {
        window.Prism = window.Prism || {};
        window.Prism.manual = true;
      },
    });
  }
  return ng18PrismLoader.cached;
}

export function ng18PdfViewerLoader() {
  if (!ng18PdfViewerLoader.cached) {
    ng18PdfViewerLoader.cached = env().Hv("/lib/pdfjs/pdf.viewer.min.mjs", {
      type: "module",
      after: () => env().Jl(window, "pdfjsViewer"),
    });
  }
  return ng18PdfViewerLoader.cached;
}

export function ng18CmModesLoader() {
  if (!ng18CmModesLoader.cached) {
    ng18CmModesLoader.cached = env().Hv("/lib/codemirror/modes.min.js");
  }
  return ng18CmModesLoader.cached;
}

export async function ng18LoadMathJax() {
  await ng18MathJaxLoader().promise;
}

export async function ng18LoadMermaid() {
  await ng18MermaidLoader().promise;
  return window.mermaid;
}

export async function ng18LoadPrism() {
  await ng18PrismLoader().promise;
  return window.Prism;
}

export async function ng18LoadPdfJs() {
  await ng18PdfJsLoader().promise;
  return window.pdfjsLib;
}

export async function ng18LoadPdfViewer() {
  await ng18PdfJsLoader().promise;
  await ng18PdfViewerLoader().promise;
  return window.pdfjsViewer;
}

// Serializes worker round-trips: at most one message is in flight.
export function ng18WorkerBridge() {
  return class Ng18WorkerBridge {
    constructor(worker) {
      this.promise = null;
      this.worker = worker;
      this.worker.onmessage = this.onMessage.bind(this);
    }

    onMessage(event) {
      if (this.promise) {
        const pending = this.promise;
        this.promise = null;
        pending.resolve(event.data);
      }
    }

    submit(message, transfer) {
      if (this.promise) return null;
      this.promise = s04CreateDeferred();
      this.worker.postMessage(message, transfer);
      return this.promise.promise;
    }
  };
}

export async function ng18WorkerScript(url, options) {
  try {
    const resolved = new URL(url, document.baseURI);
    if (resolved.origin === location.origin) {
      try {
        return new Worker(url, options);
      } catch (e) {
        // fall through to fetch+blob
      }
    }
  } catch (e) {
    // unresolvable URL — fetch+blob
  }
  return ng18WorkerFromScript(url, options);
}

export async function ng18WorkerFromScript(url, options) {
  const source = await env().ajaxPromise({ url });
  return new Worker(URL.createObjectURL(new Blob([source])), options);
}

export function ng18FlushMathJax() {
  const mathJax = window.MathJax;
  const sheet = mathJax && mathJax.chtmlStylesheet ? mathJax.chtmlStylesheet() : null;
  if (sheet && sheet !== ng18MathJaxSheet) {
    if (ng18MathJaxSheet && ng18MathJaxSheet.parentNode) {
      ng18MathJaxSheet.parentNode.removeChild(ng18MathJaxSheet);
    }
    ng18MathJaxSheet = sheet;
    document.head.appendChild(sheet);
  }
  if (ng18MathJaxSheet) {
    ng18MathJaxSheet.dataset.change = ng18MathJaxSheet.dataset.change === "1" ? "2" : "1";
  }
  if (ng18MathJaxTimer) {
    clearTimeout(ng18MathJaxTimer);
    ng18MathJaxTimer = 0;
  }
  if (ng18MathJaxDeferred) {
    const deferred = ng18MathJaxDeferred;
    ng18MathJaxDeferred = null;
    deferred.resolve();
  }
}

export function ng18ScheduleMathJaxFlush() {
  if (!ng18MathJaxDeferred) ng18MathJaxDeferred = s04CreateDeferred();
  if (ng18MathJaxTimer) clearTimeout(ng18MathJaxTimer);
  ng18MathJaxTimer = window.setTimeout(ng18FlushMathJax, 100);
  return ng18MathJaxDeferred.promise;
}

export function ng18TexToHtml(tex, display) {
  return window.MathJax.tex2chtml(tex, { display });
}
