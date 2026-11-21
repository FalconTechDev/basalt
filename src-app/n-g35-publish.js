// g35 clean-room: compatibility re-export of the g12 publish classes under
// ng35 names (spec g35, s24-publish). Identity with ng12Publish* is contract.
import { ng12PublishSite } from "./n-g12-s24-site.js";
import { ng12PublishSearch, ng12PublishApp } from "./n-g12-s24-app.js";

export const ng35PublishSite = ng12PublishSite;
export const ng35PublishSearch = ng12PublishSearch;
export const ng35PublishApp = ng12PublishApp;
