// g34 clean-room: link-rewriting rename base plus heading and block-id
// rename modals (spec g34 part F, second half).
import { RefMultimap, applyLinkUpdates } from "./metadata-helpers.js";
import { parseLinktext } from "./path.js";
import { plainHeading, linkSafeHeading } from "./text.js";
import { ng34RewriteLinkText } from "./n-g34-links.js";

// Shared base: collects link updates, rewrites the renamed file's own
// references through vault.process, everything else via metadataCache.
export function ng34DefineRenameLinkModal(host) {
  return class Ng34RenameLinkModal extends host.TextInputModal {
    constructor(app, editor, file, tokenRange, initialValue) {
      super(app, initialValue);
      this.editor = editor;
      this.file = file;
      this.tokenRange = tokenRange;
    }

    async submit(value) {
      const error = this.validate(value);
      if (error) {
        this.displayError(error, false);
        return true;
      }
      const changes = this.getChanges(value);
      const fileCount = changes.data.size;
      const linkCount = changes.count();
      if (linkCount !== 0) {
        const own = changes.get(this.file.path);
        if (own && own.length > 0) {
          changes.clear(this.file.path);
          const replacement = this.replaceInFile(value);
          own.push({
            sourcePath: this.file.path,
            change: replacement.text,
            reference: {
              link: "",
              original: "",
              position: {
                start: { line: 0, col: 0, offset: replacement.start },
                end: { line: 0, col: 0, offset: replacement.end },
              },
            },
          });
          await this.app.vault.process(this.file, (content) => applyLinkUpdates(content, own));
        } else {
          this.replaceInEditor(value);
        }
        await this.app.metadataCache.updateInternalLinks(changes);
        new host.Notice(host.t.dialogue.msgUpdatedLinks({
          links: host.t.nouns.linkWithCount({ count: linkCount }),
          files: host.t.nouns.fileWithCount({ count: fileCount }),
        }));
      } else {
        this.replaceInEditor(value);
      }
      const custom = this.getCustomReplacements(value);
      for (const updater of Object.values(this.app.metadataCache.linkUpdaters)) {
        await updater.renameSubpath(this.file, custom.oldSubpath, custom.newSubpath);
      }
      this.close();
      return undefined;
    }
  };
}

// Iterates every link reference in the vault; `match(parsed)` decides
// whether the reference's subpath targets the renamed heading/block.
function ng34ScanRefs(modal, host, value, match, makeLink) {
  const changes = new RefMultimap();
  modal.app.metadataCache.iterateAllRefs((sourceFile, reference) => {
    const parsed = parseLinktext(reference.link);
    if (!parsed.subpath) return;
    if (!match(parsed)) return;
    if (modal.app.metadataCache.getFirstLinkpathDest(parsed.path, sourceFile) !== modal.file) return;
    changes.add(sourceFile, {
      sourcePath: sourceFile,
      reference,
      change: ng34RewriteLinkText(reference, makeLink(parsed, value), host),
    });
  });
  return changes;
}

export function ng34DefineHeadingRenameModal(host) {
  const LinkBase = ng34DefineRenameLinkModal(host);
  return class Ng34HeadingRenameModal extends LinkBase {
    constructor(app, editor, file, tokenRange, oldHeading) {
      super(app, editor, file, tokenRange, oldHeading);
      this.oldHeading = oldHeading;
      this.title = host.t.dialogue.labelRenameHeading();
    }

    validate(value) {
      return value === "" ? host.t.dialogue.msgHeadingEmpty() : "";
    }

    getChanges(value) {
      const oldPlain = plainHeading(this.oldHeading).toLowerCase();
      return ng34ScanRefs(this, host, value,
        (parsed) => plainHeading(parsed.subpath.substring(1)).toLowerCase() === oldPlain,
        (parsed, v) => parsed.path + "#" + linkSafeHeading(v));
    }

    replaceInEditor(value) {
      const line = this.editor.offsetToPos(this.tokenRange.start).line;
      const text = this.editor.getLine(line);
      this.editor.setLine(line, this.replaceHeadingText(text, value));
    }

    replaceInFile(value) {
      const line = this.editor.offsetToPos(this.tokenRange.start).line;
      const text = this.editor.getLine(line);
      return { ...this.tokenRange, text: this.replaceHeadingText(text, value) };
    }

    replaceHeadingText(line, value) {
      return line.replace(/^(#{1,6} ).*/m, (m, marks) => marks + value);
    }

    getCustomReplacements(value) {
      return {
        oldSubpath: plainHeading(this.oldHeading).toLowerCase(),
        newSubpath: linkSafeHeading(value),
      };
    }
  };
}

export function ng34DefineBlockIdRenameModal(host) {
  const LinkBase = ng34DefineRenameLinkModal(host);
  const wanted = (token) => ("#" + token.text).toLowerCase();
  return class Ng34BlockIdRenameModal extends LinkBase {
    constructor(app, editor, file, tokenRange, token) {
      super(app, editor, file, tokenRange, token.text.substring(1));
      this.token = token;
      this.title = host.t.dialogue.labelRenameBlockid();
    }

    validate(value) {
      if (value === "") return host.t.dialogue.msgBlockIdEmpty();
      return /^[a-zA-Z0-9\-]+$/.test(value) ? "" : host.t.dialogue.msgBlockIdInvalid();
    }

    getChanges(value) {
      const target = wanted(this.token);
      return ng34ScanRefs(this, host, value,
        (parsed) => parsed.subpath.toLowerCase() === target,
        (parsed, v) => parsed.path + "#^" + v);
    }

    replaceInEditor(value) {
      this.editor.replaceRange("^" + value, this.token.start, this.token.end);
    }

    replaceInFile(value) {
      return { ...this.tokenRange, text: "^" + value };
    }

    getCustomReplacements(value) {
      return { oldSubpath: this.token.text.toLowerCase(), newSubpath: "^" + value };
    }
  };
}
