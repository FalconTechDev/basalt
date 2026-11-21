// g34 clean-room: rename modals — file rename, link-rewriting base,
// heading rename and block-id rename (spec g34 part F).
import { RefMultimap, applyLinkUpdates } from "./metadata-helpers.js";
import { parseLinktext } from "./path.js";
import { plainHeading, linkSafeHeading } from "./text.js";
import { ng34RewriteLinkText } from "./n-g34-links.js";

// File rename with name validation.
export function ng34DefineFileRenameModal(host) {
  return class Ng34FileRenameModal extends host.TextInputModal {
    constructor(app, file) {
      super(app, file.basename);
      this.file = file;
      if (file.extension === "md") this.title = host.t.dialogue.labelRenameFile();
    }

    validate(value) {
      const error = super.validate(value);
      if (error) return error;
      const msgs = host.t.plugins.fileExplorer;
      if (value === "") return msgs.msgEmptyFileName();
      if (host.invalidCharsPattern.test(value)) return msgs.msgInvalidCharacters() + host.invalidCharsList;
      if (value.charAt(0) === ".") return msgs.msgBadDotfile();
      if (host.unsafeCharsPattern.test(value)) return msgs.msgUnsafeCharacters() + host.unsafeCharsList;
      if (this.app.vault.checkForDuplicate(this.file, value)) return msgs.msgFileAlreadyExists();
      return "";
    }

    async submit(value) {
      const error = this.validate(value);
      if (error) {
        this.displayError(error, false);
        return true;
      }
      this.close();
      const newPath = this.file.getNewPathAfterRename(value);
      if (this.file.path === newPath) return undefined;
      try {
        await this.app.fileManager.renameFile(this.file, newPath);
        new host.Notice(host.t.dialogue.msgRenameSuccess());
      } catch (err) {
        new host.Notice(err && (err.message || err.code) ? (err.message || err.code) : String(err));
        return true;
      }
      return undefined;
    }
  };
}
