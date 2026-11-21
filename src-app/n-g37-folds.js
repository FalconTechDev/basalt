// g37 — NoteFoldStore (clean-room). Per-file fold state in localStorage under "<appId>-note-fold-<path>".

export function ng37NoteFoldStore(host) {
  return class Ng37NoteFoldStore {
    constructor(app) {
      this.app = app;
    }

    _key(path) { return "note-fold-" + path; }

    loadPath(path) {
      const data = this.app.loadLocalStorage(this._key(path));
      return data == null ? null : data;
    }

    load(file) {
      return file ? this.loadPath(file.path) : null;
    }

    savePath(path, data) {
      let value = data;
      if (value && Array.isArray(value.folds) && value.folds.length === 0) value = null;
      this.app.saveLocalStorage(this._key(path), value);
    }

    save(file, data) {
      if (!file) return;
      this.savePath(file.path, data);
    }

    cleanup() {
      const prefix = this.app.appId + "-note-fold-";
      const doomed = [];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.indexOf(prefix) === 0) doomed.push(key);
        }
      } catch (err) { return; }
      for (const key of doomed) {
        const path = key.slice(prefix.length);
        let exists = false;
        try { exists = !!this.app.vault.getAbstractFileByPath(path); } catch (err) { exists = true; }
        if (!exists) {
          try { window.localStorage.removeItem(key); } catch (err) {}
        }
      }
    }
  };
}
