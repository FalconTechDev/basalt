// Compatibility shim: keymap classes live in n-g28-scope.js / n-g28-keymap.js.
import { defineScope, defineDynamicScope } from "./n-g28-scope.js";
import { defineKeymap } from "./n-g28-keymap.js";

export { defineScope, defineDynamicScope, defineKeymap };
