// g29 clean-room: "Export to PDF" modal (spec Part A). Collects options,
// persists pdfExportSettings, asks the OS for a save path, renders the note
// through the preview pipeline into a hidden popup and calls the print IPC.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng29PdfSettingsRows, ng29PdfPrintOptions } from "./n-g29-print.js";

export function definePrintToPdfModal(host) {
  function PrintToPdfModal(app, file) {
    const self = host.DialogModal.call(this, app) || this;
    self.file = file;
    self.modalEl.addClass("mod-narrow");
    self.setTitle(host.printModalText.title());
    self.contentEl.createEl("p", {
      cls: "u-muted u-break-word",
      text: host.printModalText.caption({ filename: file.basename }),
    });
    const settings = app.vault.getConfig("pdfExportSettings") || {};
    const fieldFor = { includeName: "includeName", pageSize: "pageSize", landscape: "landscape", margin: "marginsType", downscalePercent: "scaleFactor" };
    for (const row of ng29PdfSettingsRows(host)) {
      const setting = new host.Setting(self.contentEl);
      setting.setName(row.label());
      const assign = (control) => { self[fieldFor[row.key]] = control; };
      const init = (control) => { Promise.resolve(control.setValue(settings[row.key])).then(assign); };
      if (row.kind === "toggle") {
        setting.addToggle(init);
      } else if (row.kind === "dropdown") {
        setting.addDropdown((control) => {
          for (const opt of row.options) control.addOption(opt[0], typeof opt[1] === "function" ? opt[1]() : opt[1]);
          init(control);
        });
      } else {
        setting.addSlider((control) => {
          control.setLimits(row.limits[0], row.limits[1], row.limits[2]);
          control.setDynamicTooltip();
          init(control);
        });
      }
    }
    self.ctaEl = self.buttonContainerEl.createEl("button", {
      cls: "mod-cta",
      text: host.printModalText.buttonExportToPdf(),
    });
    self.ctaEl.onClickEvent(() => self.confirmExport());
    self.addCancelButton();
    return self;
  }
  inherit(PrintToPdfModal, host.DialogModal);

  const proto = PrintToPdfModal.prototype;

  proto.onOpen = function () {
    const base = host.DialogModal.prototype.onOpen;
    if (base) base.call(this);
    this.win.setTimeout(() => this.ctaEl.focus(), 0);
  };

  proto.confirmExport = async function () {
    const self = this;
    self.ctaEl.addClass("mod-loading");
    const config = {
      includeName: self.includeName.getValue(),
      pageSize: self.pageSize.getValue(),
      landscape: self.landscape.getValue(),
      margin: self.marginsType.getValue(),
      downscalePercent: self.scaleFactor.getValue(),
    };
    await self.app.vault.setConfig("pdfExportSettings", config);
    const options = ng29PdfPrintOptions(config, config.margin, config.downscalePercent);
    const electron = host.electronBridge("electron");
    const result = await electron.remote.dialog.showSaveDialog({
      defaultPath: self.file.basename + ".pdf",
      filters: [
        { name: "PDF Files", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["showOverwriteConfirmation"],
    });
    self.ctaEl.removeClass("mod-loading");
    if (result.canceled || !result.filePath) return;
    options.filepath = result.filePath;
    self.close();
    self.printToPdf(options);
  };

  proto.printToPdf = async function (options) {
    const self = this;
    const popup = window.open("about:blank", "_blank", "popup,hide=true");
    const popupDoc = popup.document;
    const base = popupDoc.createElement("base");
    base.href = location.href;
    popupDoc.head.appendChild(base);
    popupDoc.title = self.file.basename;
    host.applyEnhancements(popup);
    host.applyLanguage(popupDoc);
    host.attachElectron(popup);
    host.mirrorStyles(popup, [base])();
    host.waitModal.instance.setMessage(host.t.dialogue.preparingPdf()).show();
    try {
      await host.sleep(200);
      popupDoc.body.classList.remove("theme-dark");
      popupDoc.body.classList.add("theme-light");
      const container = popupDoc.createElement("div");
      container.className = "print";
      popupDoc.body.appendChild(container);
      const component = new host.Component();
      component.load();
      container.addEventListener("click", () => {
        container.detach();
        component.unload();
        popup.close();
        host.waitModal.instance.hide();
      });
      await self.print(container, component, options.includeName);
      await host.sleep(200);
      await host.printToPdfIpc(container.win.electron, options);
      new host.Notice("PDF Saved to " + options.filepath);
    } catch (error) {
      console.error(error);
      new host.Notice("Failed to save PDF.");
    } finally {
      host.waitModal.instance.hide();
    }
  };

  proto.testPrint = function () {
    const container = document.body.createDiv("print");
    const component = new host.Component();
    container.addEventListener("click", () => {
      container.detach();
      component.unload();
    });
    this.print(container, component, true);
  };

  proto.print = async function (container, component, includeName) {
    const self = this;
    const preview = container.createDiv("markdown-preview-view markdown-rendered");
    const config = (key) => self.app.vault.getConfig(key);
    preview.toggleClass("rtl", !!config("rightToLeft"));
    preview.toggleClass("show-properties", config("propertiesInDocument") !== "hidden");
    if (includeName) preview.createEl("h1", { text: self.file.basename });
    const source = await self.app.vault.cachedRead(self.file);
    const tree = host.markdownTree(source);
    const frontmatter = host.treeFrontmatter(tree);
    const html = host.sanitizeHtml(host.treeToHtml(tree, frontmatter));
    for (const child of Array.from(html.children || html.childNodes)) {
      if (child.nodeType !== 1) continue;
      if (child.tagName === "HR") preview.appendChild(child);
      else preview.appendChild(preview.ownerDocument.createElement("div")).appendChild(child);
    }
    for (const cls of host.frontmatterClasses(frontmatter)) preview.addClass(cls);
    const ctx = {
      docId: host.randomHex(16),
      sourcePath: self.file.path,
      frontmatter,
      promises: [],
      addChild: (child) => component.addChild(child),
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: preview,
      el: preview,
      displayMode: true,
    };
    host.MarkdownPreviewView.postProcess(self.app, ctx);
    if (ctx.promises.length) await Promise.all(ctx.promises);
    for (const link of preview.findAll("a.internal-link")) link.removeAttribute("href");
    return preview;
  };

  return PrintToPdfModal;
}
