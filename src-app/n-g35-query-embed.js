// g35 clean-room: ```query embed — runs a search query over the vault and
// renders hits through the shared search-results component (spec g35).
import { env } from "./env.js";
import { inherit } from "./inherit.js";

// Blank out every ```query fenced block, preserving offsets, so the embed
// does not match itself when the source file is searched.
function ng35MaskQueryBlocks(text) {
  return text.replace(/```query[\s\S]*?```/g, (block) => " ".repeat(block.length));
}

/** Query-results embed: ctor (app, containerEl, query, sourcePath). */
export function ng35DefineQueryResults(host) {
  function QueryResults(app, containerEl, query, sourcePath) {
    host.MarkdownRenderChild.call(this, containerEl);
    this.app = app;
    this.query = query;
    this.sourcePath = sourcePath;
    this.searchQuery = null;
    this.dom = new (env().sz)(app, containerEl, env().gm.plugins.search.labelNoMatches());
    this.queue = new (env().aq)(app, this.dom);
    this.addChild(this.queue);
  }
  inherit(QueryResults, host.MarkdownRenderChild);
  QueryResults.prototype.onload = function () {
    this.dom.emptyResults();
    try {
      const query = new (env().BH)(this.app, this.query.replace(/\r?\n/g, " "), false);
      if (!query.matcher) return;
      this.searchQuery = query;
      const job = this.queue.start();
      env().VH(this.app, query.requiredInputs, job, (file, text) => {
        const haystack = file.path === this.sourcePath ? ng35MaskQueryBlocks(text) : text;
        const match = query.match(file, haystack);
        if (match) this.dom.addResult(file, match, haystack);
        else this.dom.removeResult(file);
      });
    } catch (e) {
      console.log(e);
    }
  };
  QueryResults.prototype.onResize = function () {
    this.dom.onResize();
  };
  return QueryResults;
}
