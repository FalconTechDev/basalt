// g34 clean-room: WeakMap compatibility shim and worker helpers
// (spec g34 part I).
import { env } from "./env.js";

let ng34WeakMapBoxClass = null;
let ng34WeakMapFallbackClass = null;
let ng34WorkerChannelClass = null;

// Real-WeakMap-backed map with chainable set().
export function ng34DefineWeakMapBox() {
  if (!ng34WeakMapBoxClass) {
    ng34WeakMapBoxClass = class Ng34WeakMapBox {
      constructor() {
        this.map = new WeakMap();
      }
      get(key) { return this.map.get(key); }
      set(key, value) { this.map.set(key, value); return this; }
      has(key) { return this.map.has(key); }
      delete(key) { return this.map.delete(key); }
    };
  }
  return ng34WeakMapBoxClass;
}

let ng34WeakKeyCounter = 0;

// Property-keyed fallback for engines without WeakMap.
export function ng34DefineWeakMapFallback() {
  if (!ng34WeakMapFallbackClass) {
    ng34WeakMapFallbackClass = class Ng34WeakMapFallback {
      constructor() {
        this._ = "_weakmap_" + ng34WeakKeyCounter++;
      }
      set(key, value) {
        Object.defineProperty(key, this._, { value, configurable: true });
        return this;
      }
      get(key) {
        return this.has(key) ? key[this._] : undefined;
      }
      has(key) {
        return Object.prototype.hasOwnProperty.call(key, this._);
      }
      delete(key) {
        return this.has(key) && delete key[this._];
      }
    };
  }
  return ng34WeakMapFallbackClass;
}

export function ng34CreateWeakMap() {
  return window.WeakMap ? new (ng34DefineWeakMapBox())() : new (ng34DefineWeakMapFallback())();
}

// One-request-at-a-time RPC channel over a Worker; any message resolves
// the pending request (no id matching).
export function ng34DefineWorkerChannel(host) {
  if (!ng34WorkerChannelClass) {
    ng34WorkerChannelClass = class Ng34WorkerChannel {
      constructor(worker) {
        this.worker = worker;
        this.promise = null;
        worker.onmessage = this.onReceiveMessageFromWorker.bind(this);
      }
      onReceiveMessageFromWorker(event) {
        const pending = this.promise;
        if (!pending) return;
        this.promise = null;
        pending.resolve(event.data);
      }
      submit(message, transfer) {
        if (this.promise) return null;
        const deferred = env().gb();
        this.promise = deferred;
        this.worker.postMessage(message, transfer);
        return deferred.promise;
      }
    };
  }
  return ng34WorkerChannelClass;
}

// Fetches the worker script and builds a blob: URL worker.
export async function ng34WorkerFromUrl(url, options) {
  const text = await env().ajaxPromise({ url });
  return new Worker(URL.createObjectURL(new Blob([text])), options);
}

// Same-origin workers are constructed directly; cross-origin (or failing)
// ones go through the blob route without options.
export async function ng34CreateWorker(url, options) {
  let parsed = null;
  try {
    parsed = new URL(url, document.baseURI);
  } catch (e) {
    parsed = null;
  }
  if (parsed && parsed.origin !== location.origin) return ng34WorkerFromUrl(url);
  try {
    return new Worker(url, options);
  } catch (e) {
    return ng34WorkerFromUrl(url);
  }
}
