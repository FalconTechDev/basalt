// Compatibility shim: the implementation lives in n-g35-media.js. Tests and
// historical importers address this module by its original file name.
import { ng35AudioViewType, ng35ImageViewType, ng35AudioView, ng35ImageView } from "./n-g35-media.js";

export const s26AudioViewType = ng35AudioViewType;
export const s26ImageViewType = ng35ImageViewType;
export const s26AudioView = ng35AudioView;
export const s26ImageView = ng35ImageView;
