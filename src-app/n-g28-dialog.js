// g28 DialogModal (spec g28 Part E): Modal plus a button row
// (addButton / addCheckbox / addCancelButton). Exposed to the bundle as `nb`
// through n-g08-bookmarks.js ng08DefineButtonModal.
import { inherit } from "./inherit.js";
import { ng28ModalFor } from "./n-g28-modal.js";

/** defineDialogModal(host) -> DialogModal class (host names ButtonModal/DialogModal). */
export function defineDialogModal(host) {
  const Modal = ng28ModalFor(host);

  function DialogModal(app) {
    const self = Modal.call(this, app) || this;
    self.containerEl.classList.add("mod-confirmation");
    const doc = self.containerEl.ownerDocument || document;
    self.buttonContainerEl = doc.createElement("div");
    self.buttonContainerEl.className = "modal-button-container";
    self.modalEl.appendChild(self.buttonContainerEl);
    return self;
  }
  inherit(DialogModal, Modal);

  DialogModal.prototype.addButton = function (cls, text, onClick) {
    const self = this;
    const doc = this.containerEl.ownerDocument || document;
    const button = doc.createElement("button");
    button.className = Array.isArray(cls) ? cls.join(" ") : cls;
    button.textContent = text;
    button.addEventListener("click", async (event) => {
      button.classList.add("mod-loading");
      try {
        const result = await onClick(event);
        if (!result) self.close();
      } finally {
        button.classList.remove("mod-loading");
      }
    });
    this.buttonContainerEl.appendChild(button);
    return this;
  };

  DialogModal.prototype.addCheckbox = function (label, onToggle) {
    const doc = this.containerEl.ownerDocument || document;
    const labelEl = doc.createElement("label");
    labelEl.className = "mod-checkbox";
    const input = doc.createElement("input");
    input.type = "checkbox";
    input.tabIndex = -1;
    labelEl.appendChild(input);
    labelEl.appendChild(doc.createTextNode(label));
    input.addEventListener("click", (event) => { if (onToggle) onToggle(event); });
    this.buttonContainerEl.appendChild(labelEl);
    return this;
  };

  DialogModal.prototype.addCancelButton = function (onCancel) {
    return this.addButton("mod-cancel", host.t.dialogue.buttonCancel(), (event) => {
      if (onCancel) onCancel(event);
    });
  };

  DialogModal.prototype.onClose = function () {
    host.hideTooltip();
  };

  return DialogModal;
}
