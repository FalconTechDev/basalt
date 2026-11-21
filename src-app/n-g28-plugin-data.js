// g28 Plugin base class, part 2 (spec g28 Part F): data.json persistence,
// styles.css loading, mtime tracking and the external-change debounce target.
// Attached to the Plugin prototype by n-g28-plugin.js.

/** Adds the persistence/lifecycle-data methods to the Plugin class. */
export function ng28PluginData(Plugin, host, normalizePath) {
  Plugin.prototype.loadData = async function () {
    const data = await this.app.vault.readPluginData(this.manifest.dir);
    if (data && typeof this.onExternalSettingsChange === "function") {
      this._lastDataModifiedTime = await this.getModifiedTime();
    }
    return data;
  };

  Plugin.prototype.saveData = async function (data) {
    const now = Date.now();
    this._lastDataModifiedTime = now;
    return this.app.vault.writePluginData(this.manifest.dir, data, { mtime: now });
  };

  /** Loads <dir>/styles.css before the user's custom CSS (so custom CSS wins). */
  Plugin.prototype.loadCSS = async function () {
    const file = normalizePath(this.manifest.dir + "/" + host.PLUGIN_STYLES_FILE);
    if (!(await this.app.vault.exists(file))) return;
    const css = await this.app.vault.readRaw(file);
    const doc = document;
    const style = doc.createElement("style");
    style.type = "text/css";
    style.textContent = css;
    doc.head.insertBefore(style, this.app.customCss.styleEl);
    this.register(() => { if (style.parentNode) style.parentNode.removeChild(style); });
  };

  Plugin.prototype.getModifiedTime = async function () {
    try {
      const stat = await this.app.vault.adapter.stat(normalizePath(this.manifest.dir + "/data.json"));
      return stat ? stat.mtime : 0;
    } catch (e) {
      return 0;
    }
  };

  /** Debounced target of onConfigFileChange: fires onExternalSettingsChange
   * only when the on-disk mtime is newer than the last one we saw. */
  Plugin.prototype._onConfigFileChange = async function () {
    if (typeof this.onExternalSettingsChange !== "function") return;
    const modified = await this.getModifiedTime();
    if (this._lastDataModifiedTime < modified) await this.onExternalSettingsChange();
    this._lastDataModifiedTime = modified;
  };
}
