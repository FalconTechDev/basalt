// g27: implementation lives in n-g27-env.js; this shim keeps the historic
// module path working for the ~190 importers and the spec-test HTTP loader.
import { env, hostEnv, bindEnv } from "./n-g27-env.js";
export { env, hostEnv, bindEnv };
