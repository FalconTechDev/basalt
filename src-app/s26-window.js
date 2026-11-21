// Compatibility shim: the implementation lives in n-g35-window.js. Tests and
// historical importers address this module by its original file name.
import { ng35TrackWindowFocus, ng35InstallEnhancements, ng35AttachElectron } from "./n-g35-window.js";

export const s26TrackWindowFocus = ng35TrackWindowFocus;
export const s26InstallEnhancements = ng35InstallEnhancements;
export const s26AttachElectron = ng35AttachElectron;
