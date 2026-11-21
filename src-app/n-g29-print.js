// g29 clean-room: PDF export settings rows + print-options derivation +
// the note->preview render pipeline (spec Part A).

export const NG29_PAGE_SIZES = ["A3", "A4", "A5", "Legal", "Letter", "Tabloid"];

// option id -> i18n label key on printModalText; "0"=default "2"=minimal "1"=none
export const NG29_MARGIN_OPTIONS = [
  ["0", "settingMarginDefault"],
  ["2", "settingMarginMinimal"],
  ["1", "settingMarginNone"],
];

export function ng29PdfSettingsRows(host) {
  const text = host.printModalText;
  return [
    { key: "includeName", label: () => text.settingIncludeFileName(), kind: "toggle" },
    { key: "pageSize", label: () => text.settingPageSize(), kind: "dropdown", options: NG29_PAGE_SIZES.map((v) => [v, v]) },
    { key: "landscape", label: () => text.settingLandscape(), kind: "toggle" },
    { key: "margin", label: () => text.settingMargin(), kind: "dropdown", options: NG29_MARGIN_OPTIONS.map(([v, k]) => [v, () => text[k]()]) },
    { key: "downscalePercent", label: () => text.settingDownscalePercent(), kind: "slider", limits: [10, 100, 1] },
  ];
}

export function ng29PdfPrintOptions(config, margin, downscalePercent) {
  const options = {
    includeName: config.includeName,
    pageSize: config.pageSize,
    landscape: config.landscape,
    marginsType: parseInt(margin, 10),
    scaleFactor: downscalePercent,
    scale: Math.clamp(downscalePercent / 100, 0.1, 2),
    open: true,
  };
  if (options.marginsType === 1 || options.marginsType === 2) {
    options.margins = { top: 0, left: 0, bottom: 0, right: 0 };
  }
  return options;
}
