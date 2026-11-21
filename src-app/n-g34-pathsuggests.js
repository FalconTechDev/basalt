// g34 clean-room: path/file/folder suggest classes (spec g34 part E).

// Markdown-files-only file suggest.
export function ng34DefineMarkdownFileSuggest(host) {
  return class Ng34MarkdownFileSuggest extends host.FilePathSuggest {
    filePredicate(file) {
      return file.extension === "md";
    }
  };
}

// File suggest filtered by an arbitrary predicate.
export function ng34DefinePredicatedFileSuggest(host) {
  return class Ng34PredicatedFileSuggest extends host.FilePathSuggest {
    constructor(app, textInputEl, predicate, ...rest) {
      super(app, textInputEl, ...rest);
      this.predicate = predicate;
    }
    filePredicate(file) {
      return !this.predicate || this.predicate(file);
    }
  };
}

// Folder suggest filtered by an arbitrary predicate; the FolderSuggest base
// reuses the filePredicate hook for its candidates.
export function ng34DefinePredicatedFolderSuggest(host) {
  return class Ng34PredicatedFolderSuggest extends host.FolderSuggest {
    constructor(app, textInputEl, folderPredicate, allowNullSelection = false) {
      super(app, textInputEl, allowNullSelection);
      this.folderPredicate = folderPredicate;
    }
    filePredicate(folder) {
      return !this.folderPredicate || this.folderPredicate(folder);
    }
  };
}
