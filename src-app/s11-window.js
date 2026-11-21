// Compatibility shim: the implementation lives in n-g30-window.js.
import {ng30TrackWindowFocus, ng30InstallEnhance, ng30AttachElectron} from "./n-g30-window.js";

export const s11TrackWindowFocus = ng30TrackWindowFocus;
export const s11InstallEnhance = ng30InstallEnhance;
export const s11AttachElectron = ng30AttachElectron;
