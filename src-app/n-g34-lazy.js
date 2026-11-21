// g34 clean-room: lazy one-shot loaders for third-party libs under /lib/
// plus the MathJax typeset/stylesheet-flush helpers (spec g34 part H).
import { env } from "./env.js";

// Memoises the env().Hv loader call; the same {promise} returns every time.
function ng34LazyScript(url, hooks) {
  let loaded = null;
  return () => {
    if (!loaded) loaded = env().Hv(url, hooks);
    return loaded;
  };
}

const ng34LoadPdfLibOnce = ng34LazyScript("/lib/pdfjs/pdf.min.mjs", {
  type: "module",
  after() {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
    env().Jl(window, "pdfjsLib");
    env().Jl(window.pdfjsLib.GlobalWorkerOptions, "workerSrc");
  },
});

const ng34LoadPdfViewerOnce = ng34LazyScript("/lib/pdfjs/pdf.viewer.min.mjs", {
  type: "module",
  after() {
    env().Jl(window, "pdfjsViewer");
  },
});

const ng34LoadCodeMirrorModesOnce = ng34LazyScript("/lib/codemirror/modes.min.js");

const ng34MermaidInit = {
  startOnLoad: false,
  securityLevel: "strict",
  themeVariables: { fontFamily: "var(--font-mermaid)" },
  flowchart: { useMaxWidth: false },
  sequence: { useMaxWidth: false },
  gantt: { useMaxWidth: true, axisFormatter: [["%Y-%m-%d", (d) => d.getDay() === 1]] },
  journey: { useMaxWidth: true },
  class: { useMaxWidth: true },
  git: { useMaxWidth: false },
  state: { useMaxWidth: true },
  er: { useMaxWidth: false },
  pie: { useMaxWidth: true },
};

const ng34LoadMermaidLibOnce = ng34LazyScript("/lib/mermaid.min.js", {
  after() {
    window.mermaid.initialize(ng34MermaidInit);
  },
});

const ng34LoadPrismLibOnce = ng34LazyScript("/lib/prism.min.js", {
  before() {
    window.Prism = window.Prism || {};
    window.Prism.manual = true;
  },
});

const ng34MathJaxConfig = {
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

const ng34LoadMathJaxLibOnce = ng34LazyScript("/lib/mathjax/tex-chtml-full.js", {
  before() {
    window.MathJax = ng34MathJaxConfig;
    if (window.publish) delete window.MathJax.options.renderActions;
    localStorage.removeItem("MathJax-Menu-Settings");
  },
});

export function ng34LoadPdfLib() { return ng34LoadPdfLibOnce(); }
export function ng34LoadPdfViewer() { return ng34LoadPdfViewerOnce(); }
export function ng34LoadCodeMirrorModes() { return ng34LoadCodeMirrorModesOnce(); }
export function ng34LoadMermaidLib() { return ng34LoadMermaidLibOnce(); }
export function ng34LoadPrismLib() { return ng34LoadPrismLibOnce(); }
export function ng34LoadMathJaxLib() { return ng34LoadMathJaxLibOnce(); }

export async function ng34LoadPdfJs() {
  await ng34LoadPdfLib().promise;
  return window.pdfjsLib;
}

export async function ng34LoadPdfViewerJs() {
  await ng34LoadPdfLib().promise;
  await ng34LoadPdfViewer().promise;
  return window.pdfjsViewer;
}

export async function ng34LoadMermaid() {
  await ng34LoadMermaidLib().promise;
  return window.mermaid;
}

export async function ng34LoadPrism() {
  await ng34LoadPrismLib().promise;
  return window.Prism;
}

export async function ng34LoadMathJax() {
  await ng34LoadMathJaxLib().promise;
}

export function ng34RenderMath(tex, display) {
  return window.MathJax.tex2chtml(tex, { display });
}

// Module-scope mirrors of the app-scope flush state (the env-bound
// Cz/Ez/Mz names are authoritative at runtime).
export const ng34MathJaxDeferred = null;
export const ng34MathJaxTimer = 0;
export const ng34MathJaxSheet = null;
export const ng34WeakKeySeed = 0;

// Attaches the current MathJax stylesheet and resolves the pending deferred.
export function ng34FlushMathStyles() {
  const sheet = window.MathJax.chtmlStylesheet();
  const attached = env().Mz;
  if (!attached || attached !== sheet) {
    if (attached) attached.detach();
    env().Mz = sheet;
    document.head.appendChild(sheet);
  }
  sheet.dataset.change = sheet.dataset.change === "1" ? "2" : "1";
  const pending = env().Cz;
  env().Cz = null;
  if (pending) pending.resolve();
}

// Coalesces stylesheet flushes: repeated calls share one promise/timer.
export function ng34ScheduleMathFlush() {
  if (!env().Cz) env().Cz = env().gb();
  if (env().Ez) clearTimeout(env().Ez);
  env().Ez = setTimeout(ng34FlushMathStyles, 100);
  return env().Cz.promise;
}
