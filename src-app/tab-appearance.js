// The "Appearance" settings tab: base theme, accent colour, theme/snippet managers, interface
// options, font settings, zoom/frame/custom icon (desktop) and CSS snippets. The theme browser,
// font manager and ribbon dialogs are still inherited classes reached through bindEnv; the
// icon-file decoding helpers below are own code.
import { inherit } from "./inherit.js";
import { hostEnv } from "./vault.js";
import { lastSegment, extensionOf } from "./path.js";
import { ownBuffer, stringFromCodes, readInt32BE, readInt32LE } from "./misc.js";
import { parseCommaList } from "./text.js";

const BASE_THEMES = [
  { id: "basalt", nameI18n: "dark-theme" },
  { id: "moonstone", nameI18n: "light-theme" },
  { id: "system", nameI18n: "system-theme" },
];
const ICNS_TYPES = ["ic07", "ic13", "ic08", "ic14", "ic09", "ic10"];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IHDR = [73, 72, 68, 82]; // "IHDR"

/** Adds `cls` to `el` while `fn` runs. */
async function withAppearanceLoading(el, cls, fn) {
  el.addClass(cls);
  try {
    return await fn();
  } finally {
    el.removeClass(cls);
  }
}

/** Largest embedded PNG inside an .icns blob, or null. */
function pngFromIcns(bytes) {
  if (bytes.length < 8 || stringFromCodes(bytes.slice(0, 4)) !== "icns") return null;
  let at = 8;
  let best = null;
  while (at < bytes.length) {
    const type = stringFromCodes(bytes.slice(at, at + 4));
    const size = readInt32BE(bytes, at + 4);
    if (ICNS_TYPES.indexOf(type) !== -1) best = bytes.slice(at + 8, at + size);
    at += size;
  }
  return best ? ownBuffer(best) : null;
}

function uint16LE(bytes, at) { return bytes[at] | (bytes[at + 1] << 8); }

/** Largest embedded PNG inside an .ico blob, or null. */
function pngFromIco(bytes) {
  if (bytes.length < 6) return null;
  const count = uint16LE(bytes, 4);
  let bestSize = 0;
  let best = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const offset = readInt32LE(bytes, at + 12);
    const data = bytes.slice(offset, offset + readInt32LE(bytes, at + 8));
    let isPng = true;
    for (let j = 0; j < 8; j++) {
      if (data[j] !== PNG_SIGNATURE[j]) { isPng = false; break; }
    }
    if (isPng) {
      for (let j = 0; j < 4; j++) {
        if (data[12 + j] !== PNG_IHDR[j]) { isPng = false; break; }
      }
      if (isPng) {
        const w = readInt32BE(data, 16);
        const h = readInt32BE(data, 20);
        if (w * h > bestSize) { bestSize = w * h; best = data; }
      }
    }
  }
  return best ? ownBuffer(best) : null;
}

/** True when every pixel on the image border is transparent (icons need a transparent margin). */
function iconBorderTransparent(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h);
  const alpha = (x, y) => data.data[4 * (x * w + y) + 3];
  const d = Math.floor(3 * Math.min(w, h) / 32);
  const n = Math.floor(d / 2);
  for (let i = 0; i < n; i++) {
    for (let x = 0; x < w; x++) {
      if (alpha(x, i) > 128 || alpha(x, h - i - 1) > 128) return false;
    }
    for (let y = 0; y < h; y++) {
      if (alpha(i, y) > 128 || alpha(w - i - 1, y) > 128) return false;
    }
  }
  return true;
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return window.btoa(s);
}

function base64ToBuffer(text) {
  const bin = window.atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** `document.fonts.check` once fonts are ready; empty family is always "found". */
async function fontFamilyExists(family) {
  if (family === "") return true;
  await document.fonts.ready;
  return document.fonts.check('12px "' + family + '"');
}

export function defineAppearanceTab(host) {
  const env = () => hostEnv();
  const i18n = () => host.t.setting.appearance;

  /** Settings tab id "appearance". */
  function AppearanceTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = i18n().name();
    self.id = "appearance";
    self.icon = "palette";
    return self;
  }
  inherit(AppearanceTab, host.SettingTab);
  const proto = AppearanceTab.prototype;

  proto.display = function () {
    const self = this;
    const app = this.app;
    const customCss = app.customCss;
    const containerEl = this.containerEl;
    const i18nAppearance = i18n();
    containerEl.empty();

    const group = new host.SettingGroup(containerEl);

    // ---- base theme ----
    group.addSetting((setting) => {
      setting
        .setName(i18nAppearance.optionBaseTheme())
        .setDesc(i18nAppearance.optionBaseThemeDescription())
        .addDropdown((dropdown) => {
          dropdown.onChange((value) => app.changeTheme(value));
          for (const theme of BASE_THEMES) dropdown.addOption(theme.id, i18nAppearance(theme.nameI18n));
          dropdown.setValue(app.vault.getConfig("theme"));
        });
    });

    // ---- accent colour ----
    let accentExtra = null;
    let accentPicker = null;
    const syncAccent = () => {
      accentExtra.extraSettingsEl.setAttr("aria-disabled", !app.vault.getConfig("accentColor"));
    };
    group.addSetting((setting) => {
      setting
        .setName(i18nAppearance.optionAccentColor())
        .setDesc(i18nAppearance.optionAccentColorDescription())
        .setClass("mod-toggle")
        .addExtraButton((button) => {
          accentExtra = button;
          button.setIcon("lucide-rotate-ccw").setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => {
            app.vault.setConfig("accentColor", "");
            accentPicker.colorPickerEl.value = app.getAccentColor();
            syncAccent();
          });
        })
        .addColorPicker((picker) => {
          accentPicker = picker;
          picker.setValue(app.getAccentColor()).onChange((value) => {
            app.vault.setConfig("accentColor", value);
            syncAccent();
          });
        });
    });
    syncAccent();

    // ---- themes ----
    let themesSetting = null;
    group.addSetting((setting) => {
      themesSetting = setting;
      setting.setName(i18nAppearance.optionThemes()).setDesc(i18nAppearance.optionManageThemesDescription());
    });
    if (host.Platform.isDesktopApp) {
      themesSetting.addExtraButton((button) => {
        button.setIcon("lucide-folder-open").setTooltip(i18nAppearance.buttonOpenThemesFolder()).onClick(async () => {
          const folder = customCss.getThemeFolder();
          if (!(await app.vault.exists(folder))) await app.vault.createFolder(folder);
          app.openWithDefaultApp(folder);
        });
      });
    }
    themesSetting.addDropdown((dropdown) => {
      dropdown.then((d) => {
        const css = app.customCss;
        d.addOption("", host.t.setting.appearance.labelDefaultTheme());
        for (const id in css.themes) if (css.themes.hasOwnProperty(id)) d.addOption(id, id);
        for (const id of css.oldThemes) {
          if (!css.themes.hasOwnProperty(id)) d.addOption(id, id + " (Legacy)");
        }
        d.setValue(css.themes.hasOwnProperty(css.theme) ? css.theme : "");
      }).onChange((value) => app.customCss.setTheme(value));
    });
    themesSetting.addButton((button) => {
      button.setButtonText(i18nAppearance.optionThemeButtonManage()).setCta().onClick(() => {
        new env().A0(app, false).setCloseCallback(() => self.display()).open();
      });
    });

    const themeCount = Object.keys(customCss.themes).length + customCss.oldThemes.length;
    const updateCount = Object.keys(customCss.updates).length;
    group.addSetting((setting) => {
      setting
        .setName(i18nAppearance.labelCurrentThemes())
        .setDesc(i18nAppearance.labelCurrentlyInstalled({ count: themeCount }) + " " + (updateCount > 0 ? i18nAppearance.msgUpdatesFound({ count: updateCount }) : ""))
        .then((s) => {
          if (updateCount > 0) {
            s.addButton((button) => {
              button.setButtonText(i18nAppearance.buttonViewUpdates()).onClick(() => {
                new env().A0(app, true).setCloseCallback(() => self.display()).open();
              });
            });
            s.addButton((button) => {
              button.setCta().setButtonText(i18nAppearance.buttonUpdateAllThemes()).onClick(() =>
                withAppearanceLoading(self.containerEl, "is-loading", async () => {
                  const updates = Object.values(customCss.updates);
                  for (const update of updates) await customCss.installTheme(update.themeInfo, update.version);
                  self.display();
                }));
            });
          } else if (themeCount > 0) {
            s.addButton((button) => {
              button.setCta().setButtonText(i18nAppearance.buttonCheckForUpdates()).onClick(async () => {
                await withAppearanceLoading(self.containerEl, "is-loading", () => customCss.checkForUpdates());
                self.display();
              });
            });
          }
        });
    });

    // ---- interface ----
    const interfaceGroup = new host.SettingGroup(containerEl).setHeading(i18nAppearance.optionInterface());
    const P = host.Platform;
    if (P.isPhone) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionAutoFullScreen())
          .setDesc(host.t.setting.appearance.optionAutoFullScreenDesc())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("autoFullScreen")).onChange((value) => app.vault.setConfig("autoFullScreen", value));
          });
      });
    }
    if (P.isMobile) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionFloatingNavigation())
          .setDesc(host.t.setting.appearance.optionFloatingNavigationDesc())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("floatingNavigation")).onChange((value) => app.vault.setConfig("floatingNavigation", value));
          });
      });
    }
    if (P.isPhone) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionSlidingSidebar())
          .setDesc(host.t.setting.appearance.optionSlidingSidebarDesc())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("slidingSidebar")).onChange((value) => {
              app.vault.setConfig("slidingSidebar", value);
              app.workspace.leftSplit.collapse();
              app.workspace.rightSplit.collapse();
            });
          });
      });
    }
    interfaceGroup
      .addSetting((setting) => {
        setting
          .setName(host.t.setting.editor.optionShowInlineTitle())
          .setDesc(host.t.setting.editor.optionShowInlineTitleDescription())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("showInlineTitle")).onChange((value) => app.vault.setConfig("showInlineTitle", value));
          });
      });
    if (!P.isPhone) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionShowViewHeader())
          .setDesc(host.t.setting.appearance.optionShowViewHeaderDesc())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("showViewHeader")).onChange((value) => app.vault.setConfig("showViewHeader", value));
          });
      });
    }
    if (P.canDisplayRibbon) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionShowRibbon())
          .setDesc(host.t.setting.appearance.optionShowRibbonDesc())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("showRibbon")).onChange((value) => {
              app.vault.setConfig("showRibbon", value);
              self.display();
            });
          });
      });
    }
    if (P.isMobile || app.vault.getConfig("showRibbon")) {
      interfaceGroup.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionConfigureRibbon())
          .setDesc(host.t.setting.appearance.optionConfigureRibbonDesc())
          .addButton((button) => {
            button.setButtonText(host.t.dialogue.buttonManage()).onClick(() => new env().ete(app).open());
          });
      });
    }

    // ---- fonts ----
    const fontGroup = new host.SettingGroup(containerEl).setHeading(i18nAppearance.optionFont());
    const addFontSetting = (name, desc, configKey) => {
      let row = null;
      const refresh = () => {
        const families = parseCommaList(app.vault.getConfig(configKey));
        const fragment = createFragment();
        fragment.appendText(desc);
        if (families.length === 1) {
          fragment.createSpan({ text: i18nAppearance.labelSingleFontCurrentlyInEffect() });
          fragment.createSpan({ text: families[0], cls: "u-pop" });
        } else if (families.length > 1) {
          fragment.createSpan({ text: i18nAppearance.labelMultipleFontsCurrentlyInEffect() });
          const list = fragment.createEl("ul");
          for (const family of families) {
            const item = list.createEl("li", "");
            item.createSpan({ text: family });
            fontFamilyExists(family).then((found) => {
              if (!found) {
                item.appendText(" ");
                item.createSpan("mod-warning", (el) => {
                  host.setIcon(el, "lucide-alert-circle");
                  host.setTooltip(el, host.t.setting.appearance.msgFontNotFound());
                });
              }
            });
          }
        }
        row.setDesc(fragment);
      };
      fontGroup.addSetting((setting) => {
        row = setting;
        setting.setName(name).addButton((button) => {
          button.setButtonText(i18nAppearance.optionThemeButtonManage()).onClick(() => {
            new env().zee(app, name, parseCommaList(app.vault.getConfig(configKey)), (values) => {
              app.vault.setConfig(configKey, values.join(","));
              refresh();
            }).open();
          });
        });
      });
      refresh();
    };
    addFontSetting(i18nAppearance.optionInterfaceFont(), i18nAppearance.optionInterfaceFontDescription(), "interfaceFontFamily");
    addFontSetting(i18nAppearance.optionTextFont(), i18nAppearance.optionTextFontDescription(), "textFontFamily");
    addFontSetting(i18nAppearance.optionMonospaceFont(), i18nAppearance.optionMonospaceFontDescription(), "monospaceFontFamily");

    const defaultFontSize = env().PC.baseFontSize;
    let fontSizeExtra = null;
    let fontSizeSlider = null;
    const syncFontSize = (value) => {
      fontSizeExtra.extraSettingsEl.setAttribute("aria-disabled", String(value === defaultFontSize));
    };
    fontGroup
      .addSetting((setting) => {
        setting
          .setName(i18nAppearance.optionFontSize())
          .setDesc(i18nAppearance.optionFontSizeDescription())
          .addExtraButton((button) => {
            fontSizeExtra = button;
            button.setIcon("lucide-rotate-ccw").setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => fontSizeSlider.setValue(defaultFontSize));
          })
          .addSlider((slider) => {
            fontSizeSlider = slider
              .setLimits(10, 30, 1)
              .setDynamicTooltip()
              .setValue(app.vault.getConfig("baseFontSize"))
              .onChange((value) => {
                app.vault.setConfig("baseFontSize", value);
                syncFontSize(value);
              });
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nAppearance.optionFontSizeAction())
          .setDesc(i18nAppearance.optionFontSizeActionDescription())
          .addToggle((toggle) => {
            toggle.setValue(app.vault.getConfig("baseFontSizeAction")).onChange((value) => app.vault.setConfig("baseFontSizeAction", value));
          });
      });
    syncFontSize(fontSizeSlider.getValue());

    // ---- advanced (desktop) ----
    if (P.isDesktopApp) {
      const advanced = new host.SettingGroup(containerEl).setHeading(i18nAppearance.optionAdvanced());
      const electron = env().electron;
      let zoomExtra = null;
      let zoomSlider = null;
      let relaunchZoom = null;
      const syncZoom = (value) => {
        zoomExtra.extraSettingsEl.setAttribute("aria-disabled", String(value === 0));
      };
      advanced.addSetting((setting) => {
        setting
          .setName(i18nAppearance.optionZoomLevel())
          .setDesc(i18nAppearance.optionZoomLevelDescription())
          .addExtraButton((button) => {
            zoomExtra = button;
            button.setIcon("lucide-rotate-ccw").setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => {
              electron.webFrame.setZoomLevel(0);
              zoomSlider.setValue(0);
            });
          })
          .addSlider((slider) => {
            zoomSlider = slider.setLimits(-2.5, 3, 0.5).setDynamicTooltip().setValue(electron.webFrame.getZoomLevel()).onChange((value) => {
              electron.webFrame.setZoomLevel(value);
              syncZoom(value);
            });
            slider.getValuePretty = function () { return "" + Math.round(100 * Math.pow(1.2, this.getValue())) + "%"; };
            syncZoom(slider.getValue());
          });
      });
      advanced.addSetting((setting) => {
        setting
          .setName(host.t.setting.appearance.optionNativeMenus())
          .setDesc(host.t.setting.appearance.optionNativeMenusDesc())
          .addToggle((toggle) => {
            toggle.setValue(host.Menu.useNativeMenu).onChange((value) => app.vault.setConfig("nativeMenus", value));
          });
      });

      const frameStyle = electron.ipcRenderer.sendSync("frame");
      let frameRelaunch = null;
      advanced.addSetting((setting) => {
        setting
          .setName(i18nAppearance.optionFrameStyle())
          .setDesc(i18nAppearance.optionFrameDescription())
          .addButton((button) => {
            frameRelaunch = button;
            button.setCta().setButtonText(host.t.setting.about.buttonRelaunch()).onClick(() => {
              electron.remote.app.relaunch();
              electron.remote.app.quit();
            });
            button.buttonEl.hide();
          })
          .addDropdown((dropdown) => {
            dropdown.onChange((value) => {
              electron.ipcRenderer.sendSync("frame", value);
              frameRelaunch.buttonEl.show();
            });
            dropdown.addOption("hidden", i18nAppearance.optionFrameHidden());
            dropdown.addOption("custom", i18nAppearance.optionFrameObsidian());
            dropdown.addOption("native", i18nAppearance.optionFrameNative());
            dropdown.setValue(frameStyle || "hidden");
          });
      });

      // ---- custom icon ----
      const path = env().If("path");
      const fs = env().If("fs");
      const url = env().If("url");
      const remote = electron.remote;
      let iconRow = null;
      let iconReset = null;
      let iconRelaunch = null;
      let chooseButton = null;

      const iconUrl = (name) => {
        const full = path.join(remote.app.getPath("userData"), name);
        let href = url.pathToFileURL(full).href;
        if (href.startsWith("file:///")) href = href.substring(8);
        else if (href.startsWith("file://")) href = "%5C%5C" + href.substring(7);
        return P.resourcePathPrefix + href + "?" + Date.now();
      };
      const refreshIcon = () => {
        const current = electron.ipcRenderer.sendSync("get-icon");
        iconReset.extraSettingsEl.toggle(!!current);
        if (current) {
          iconRow.setDesc(createFragment((frag) => {
            frag.createEl("img", { attr: { width: 64, height: 64, src: iconUrl(current) } });
          }));
        } else {
          iconRow.setDesc(i18nAppearance.optionCustomIconDesc());
        }
      };

      advanced.addSetting((setting) => {
        iconRow = setting;
        setting
          .setName(i18nAppearance.optionCustomIcon())
          .addExtraButton((button) => {
            iconReset = button;
            button.setIcon("lucide-rotate-ccw").setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => {
              electron.ipcRenderer.sendSync("set-icon", null, null);
              refreshIcon();
              iconRelaunch.buttonEl.show();
            });
          })
          .addButton((button) => {
            chooseButton = button;
            button.setButtonText(host.t.dialogue.buttonChoose()).onClick(async () => {
              const picked = remote.dialog.showOpenDialogSync({
                title: i18nAppearance.optionCustomIcon(),
                properties: ["openFile", "dontAddToRecent"],
                filters: [{ name: "PNG/ICO/ICNS", extensions: ["png", "ico", "icns"] }],
              });
              if (!picked || picked.length === 0) return;
              const file = picked[0];
              let ext = extensionOf(lastSegment(file));
              if (!["png", "ico", "icns"].contains(ext)) {
                new host.Notice("Supported file types are: png, ico, icns");
                return;
              }
              let data = fs.readFileSync(file);
              if (ext === "icns") {
                const png = pngFromIcns(ownBuffer(data));
                if (!png) {
                  new host.Notice("This icns file does not have usable icons.");
                  return;
                }
                data = Buffer.from(png);
                ext = "png";
              }
              if (ext === "ico" && !P.isWin) {
                const png = pngFromIco(ownBuffer(data));
                if (!png) {
                  new host.Notice("This ico file does not have usable icons.");
                  return;
                }
                data = Buffer.from(png);
                ext = "png";
              }
              if (ext === "png") {
                // preview + trim: icons must keep a transparent border
                const img = new Image();
                const base64 = "data:image/png;base64," + bytesToBase64(ownBuffer(data));
                await new Promise((resolve) => {
                  const done = () => resolve();
                  img.addEventListener("load", done);
                  img.addEventListener("error", done);
                  img.src = base64;
                });
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                let out = data;
                if (!iconBorderTransparent(ctx, w, h)) {
                  const d = Math.floor(3 * Math.min(w, h) / 32);
                  ctx.clearRect(0, 0, w, h);
                  ctx.drawImage(img, d, d, w - 2 * d, h - 2 * d);
                  const cropped = canvas.toDataURL("image/png");
                  const match = cropped.match(/^data:([\w/\-.]+);base64,(.*)/);
                  out = Buffer.from(base64ToBuffer(match[2]));
                }
                electron.ipcRenderer.sendSync("set-icon", "icon." + ext, out);
              } else {
                electron.ipcRenderer.sendSync("set-icon", "icon." + ext, data);
              }
              refreshIcon();
              iconRelaunch.buttonEl.show();
            });
          })
          .addButton((button) => {
            iconRelaunch = button;
            button.setCta().setButtonText(host.t.setting.about.buttonRelaunch()).onClick(() => {
              remote.app.relaunch();
              remote.app.quit();
            });
          });
        iconRelaunch.buttonEl.hide();
        refreshIcon();
      });

      if (host.isMacLike) {
        advanced.addSetting((setting) => {
          setting
            .setName(host.t.plugins.translucency.name())
            .setDesc(host.t.plugins.translucency.desc())
            .addToggle((toggle) => {
              toggle.setValue(app.vault.getConfig("translucency")).onChange((value) => customCss.setTranslucency(value));
            });
        });
      }

      const gpuDisabled = electron.ipcRenderer.sendSync("disable-gpu");
      let gpuRelaunch = null;
      advanced.addSetting((setting) => {
        setting
          .setName(host.t.setting.about.optionHwAcceleration())
          .setDesc(createFragment((frag) => {
            frag.createDiv({ text: host.t.setting.about.optionHwAccelerationDescription() });
            frag.createDiv({ cls: "mod-warning", text: host.t.setting.about.optionHwAccelerationWarning() });
          }))
          .addButton((button) => {
            gpuRelaunch = button;
            button.setCta().setButtonText(host.t.setting.about.buttonRelaunch()).onClick(() => {
              env().Of((e) => e.ipcRenderer.sendSync("relaunch"));
            });
            button.buttonEl.hide();
          })
          .addToggle((toggle) => {
            toggle.setValue(!gpuDisabled).onChange((value) => {
              const disabled = !value;
              env().Of((e) => {
                e.ipcRenderer.sendSync("disable-gpu", disabled);
                gpuRelaunch.buttonEl.toggle(disabled !== gpuDisabled);
              });
            });
          });
      });
    }

    // ---- CSS snippets ----
    const snippets = customCss.snippets;
    const enabledSnippets = customCss.enabledSnippets;
    const snippetGroup = new host.SettingGroup(containerEl)
      .setHeading(i18nAppearance.optionCssSnippets())
      .addExtraButton((button) => {
        button.setIcon("lucide-refresh-cw").setTooltip(i18nAppearance.buttonReloadSnippets()).onClick(async () => {
          await customCss.readSnippets();
          new host.Notice(i18nAppearance.msgReloadedSnippets());
          self.display();
        });
      });
    if (P.isDesktopApp) {
      snippetGroup.addExtraButton((button) => {
        button.setIcon("lucide-folder-open").setTooltip(i18nAppearance.buttonOpenSnippetsFolder()).onClick(async () => {
          const folder = customCss.getSnippetsFolder();
          if (!(await app.vault.exists(folder))) await app.vault.createFolder(folder);
          app.openWithDefaultApp(folder);
        });
      });
    }
    if (snippets.length === 0) {
      snippetGroup.addSetting((setting) => {
        setting
          .setName(i18nAppearance.labelNoCssSnippetsFound())
          .setDesc(i18nAppearance.noSnippetDescription({ path: "vault/" + customCss.getSnippetsFolder() }));
      });
    }
    for (const snippet of snippets) {
      snippetGroup.addSetting((setting) => {
        setting
          .setName(snippet)
          .setDesc(i18nAppearance.optionToggleSnippetDescription({ path: "vault/" + customCss.getSnippetPath(snippet) }))
          .addToggle((toggle) => {
            toggle.setValue(enabledSnippets.has(snippet)).onChange((value) => customCss.setCssEnabledStatus(snippet, value));
          });
      });
    }
  };

  return AppearanceTab;
}
