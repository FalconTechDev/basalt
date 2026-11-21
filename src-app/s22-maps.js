// Compatibility shim: the implementation lives in n-g34-maps.js.
import { ng34DefineWeakMapBox, ng34DefineWeakMapFallback, ng34CreateWeakMap, ng34DefineWorkerChannel, ng34WorkerFromUrl, ng34CreateWorker } from "./n-g34-maps.js";

export const defineWeakMapBox = ng34DefineWeakMapBox;
export const defineWeakMapFallback = ng34DefineWeakMapFallback;
export const defineWorkerChannel = ng34DefineWorkerChannel;
export const s22CreateWeakMap = ng34CreateWeakMap;
export const s22WorkerFromUrl = ng34WorkerFromUrl;
export const s22CreateWorker = ng34CreateWorker;
