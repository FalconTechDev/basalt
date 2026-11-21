// g29 clean-room: vault chooser suggestion modals (spec Part H) — shared
// FuzzySuggestModal base plus the desktop switcher and mobile select pickers.
import { env } from "./env.js";
import { s05MobileVaultList } from "./s05-utils.js";

const NG29_VAULT_INSTRUCTIONS = () => {
  const cp = env().gm.plugins.commandPalette;
  return [
    { command: "↑↓", purpose: cp.instructionNavigate() },
    { command: "↵", purpose: cp.instructionUse() },
    { command: "esc", purpose: cp.instructionDismiss() },
  ];
};

export function defineVaultSuggest(host) {
  class VaultSuggest extends host.FuzzySuggestModal {
    constructor(app) {
      super(app);
      this.items = [];
      this.setPlaceholder(env().gm.commands.changeVault());
      this.setInstructions(NG29_VAULT_INSTRUCTIONS());
    }

    loadVaults() {}

    onOpen() {
      if (super.onOpen) super.onOpen();
      this.loadVaults();
    }

    getItems() { return this.items; }
    getItemText(item) { return item.name; }

    renderSuggestion(suggestion, el) {
      if (super.renderSuggestion) super.renderSuggestion(suggestion, el);
      const item = suggestion && suggestion.item !== undefined ? suggestion.item : suggestion;
      if (item && item.isCurrentVault && el && el.createSpan) {
        el.createSpan({ cls: "flair mod-pop", text: env().gm.setting.appearance.labelCurrentlyActive() });
      }
    }
  }
  return VaultSuggest;
}

export function defineVaultSwitcher(host) {
  const Base = defineVaultSuggest(host);
  class VaultSwitcher extends Base {
    constructor(app, switchVault = true) {
      super(app);
      this.switchVault = switchVault;
    }

    loadVaults() {
      const path = window.require("path");
      const ipc = env().electron.ipcRenderer;
      const current = ipc.sendSync("vault").path;
      const registry = ipc.sendSync("vault-list");
      this.items = [];
      for (const key of Object.keys(registry)) {
        const entry = registry[key];
        this.items.push({
          path: entry.path,
          name: path.basename(entry.path),
          isCurrentVault: current === entry.path,
        });
      }
      this.updateSuggestions();
    }

    onChooseItem(item) {
      if (item.isCurrentVault) return;
      const result = window.electron.ipcRenderer.sendSync("vault-open", item.path, false);
      if (result === true) {
        if (this.switchVault) window.close();
      } else {
        new (env().fb)(env().gm.interface.startScreen.msgErrorFailedToOpenVault());
      }
    }
  }
  return VaultSwitcher;
}

export function defineMobileVaultSelect(host) {
  const Base = defineVaultSuggest(host);
  class MobileVaultSelect extends Base {
    async loadVaults() {
      const selected = localStorage.getItem("mobile-selected-vault");
      const vaults = await s05MobileVaultList();
      this.items = vaults.map((vault) => ({
        path: vault.location,
        name: vault.storageType === "iCloud" ? vault.name + " (iCloud)" : vault.name,
        isCurrentVault: selected === vault.location,
      }));
      this.updateSuggestions();
    }

    onChooseItem(item) {
      if (item.isCurrentVault) return;
      localStorage.setItem("mobile-selected-vault", item.path);
      location.reload();
    }
  }
  return MobileVaultSelect;
}
