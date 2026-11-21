// g29 clean-room: HTTP response wrapping, platform-dispatched request core,
// lazy response getters, public request helpers and GitHub URL builders
// (spec Part D).
import { env } from "./env.js";

let NG29_REQUEST_ERROR_CLASS = null;

export function s04RequestErrorClass() {
  if (!NG29_REQUEST_ERROR_CLASS) {
    NG29_REQUEST_ERROR_CLASS = class RequestError extends Error {
      constructor(message, status, headers) {
        super(message);
        this.status = status;
        this.headers = headers;
      }
    };
  }
  return NG29_REQUEST_ERROR_CLASS;
}

const NG29_TEXT_DECODER = new TextDecoder();

function ng29DecodeBody(buffer) {
  return NG29_TEXT_DECODER.decode(buffer);
}

export function s04WrapResponse(opts, status, headers, body) {
  if ((!opts || opts.throw !== false) && status >= 400) {
    throw new (s04RequestErrorClass())("Request failed, status " + status, status, headers);
  }
  return {
    status,
    headers,
    arrayBuffer: body,
    get json() { return JSON.parse(ng29DecodeBody(body)); },
    get text() { return ng29DecodeBody(body); },
  };
}

function ng29BufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function ng29Base64ToBuffer(base64) {
  const bin = atob(base64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

async function ng29CapacitorRequest(opts) {
  let body = opts.body;
  let binary = false;
  if (body instanceof ArrayBuffer) {
    body = ng29BufferToBase64(body);
    binary = true;
  }
  const res = await env().xm.requestUrl({
    url: opts.url, method: opts.method, contentType: opts.contentType,
    headers: opts.headers, body, binary,
  });
  return s04WrapResponse(opts, res.status, res.headers, ng29Base64ToBuffer(res.body));
}

async function ng29ElectronRequest(opts) {
  const res = await env().Nf(opts);
  return s04WrapResponse(opts, res.status, res.headers, res.body);
}

async function ng29FetchRequest(opts) {
  const headers = opts.contentType ? { "Content-Type": opts.contentType } : null;
  const res = await fetch(opts.url, { method: opts.method, headers, body: opts.body });
  const flat = {};
  res.headers.forEach((value, key) => { flat[key] = value; });
  return s04WrapResponse(opts, res.status, flat, await res.arrayBuffer());
}

export async function s04RequestCore(opts) {
  if (typeof opts === "string") opts = { url: opts };
  if (env().Em) return ng29CapacitorRequest(opts);
  if (env().If("electron")) return ng29ElectronRequest(opts);
  return ng29FetchRequest(opts);
}

export function s04LazyResponse(promise) {
  for (const key of ["arrayBuffer", "json", "text"]) {
    Object.defineProperty(promise, key, {
      configurable: true,
      get: () => promise.then((res) => res[key]),
    });
  }
  return promise;
}

export function s04RawRequest(opts) {
  return s04LazyResponse(s04RequestCore(opts));
}

export function s04RequestText(opts) {
  return s04RequestCore(opts).then((res) => res.text);
}

export function s04Request(opts) {
  return s04LazyResponse((async () => {
    try {
      return await s04RequestCore(opts);
    } catch (err) {
      throw err;
    }
  })());
}
