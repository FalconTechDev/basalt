// g29: implementation lives in n-g29-*.js; this shim keeps the historic
// module path working for importers and the spec-test HTTP loader.
import { s04UrlQuery, s04DataUrlPattern, s04ParseDataUrl } from "./n-g29-http.js";
import { s04RequestErrorClass, s04WrapResponse, s04RequestCore, s04LazyResponse, s04RawRequest, s04RequestText, s04Request } from "./n-g29-http-req.js";
import { s04RawFileUrl, s04RepoUrl, s04ReleaseUrl, s04ProjectUrl, s04ThemeVersion } from "./n-g29-http-url.js";
export { s04UrlQuery, s04DataUrlPattern, s04ParseDataUrl, s04RequestErrorClass, s04WrapResponse, s04RequestCore, s04LazyResponse, s04RawRequest, s04RequestText, s04Request, s04RawFileUrl, s04RepoUrl, s04ReleaseUrl, s04ProjectUrl, s04ThemeVersion };
