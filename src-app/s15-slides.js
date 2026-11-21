// g32 clean-room: implementation lives in n-g32-slides-*.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineSlidesPlugin } from "./n-g32-slides-plugin.js";
import { ng32DefineSlidesView } from "./n-g32-slides-view.js";
const defineSlidesPlugin = ng32DefineSlidesPlugin;
const defineSlidesView = ng32DefineSlidesView;
export { defineSlidesPlugin, defineSlidesView };
